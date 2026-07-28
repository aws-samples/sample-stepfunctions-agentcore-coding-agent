import { Construct } from 'constructs';
import { Stack } from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface CodingHarnessProps {
  gatewayArn: string;
}

/**
 * AgentCore Harness for the simplified coding-only demo. Declares only the
 * CFN-required fields (executionRoleArn, harnessName, model) plus an explicit
 * memory opt-out - everything else (Tools, AllowedTools, SystemPrompt, etc.)
 * is optional at the resource level and is instead supplied per-invocation
 * from the state machine's invokeHarness Task state - see
 * state-machine/coding-workflow.asl.yaml, which the InvokeHarness API
 * documents as overriding the harness default when specified.
 *
 * memory.disabled is explicit, not just an omission: AgentCore creates a
 * managed memory resource by default when no `memory` config is given at
 * all, and the harness execution role isn't granted access to it - a live
 * deploy without this confirmed that gap (ListEvents AccessDeniedException
 * on the auto-created memory resource). This demo has no memory use case, so
 * opting out avoids paying for/depending on a resource nothing reads.
 */
export class CodingHarness extends Construct {
  public readonly codingHarness: agentcore.CfnHarness;

  constructor(scope: Construct, id: string, props: CodingHarnessProps) {
    super(scope, id);

    const executionRole = new iam.Role(this, 'HarnessExecutionRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });

    // Built as an explicit iam.Policy (not addToPolicy, which returns void) so
    // CodingHarness below can take a hard CDK dependency on it - IAM grants
    // must fully propagate before the AgentCore control plane validates the
    // role at harness-creation time. Needed regardless of whether Tools is
    // set on the CfnHarness resource or passed per-invocation - this grants
    // the execution role permission to call the Gateway at runtime either way.
    const executionRolePolicy = new iam.Policy(this, 'HarnessExecutionRolePolicy', {
      statements: [
        new iam.PolicyStatement({
          // modelId "us.anthropic.claude-sonnet-4-6" is a cross-region
          // inference profile, not a plain foundation model - the harness
          // calls bedrock:InvokeModelWithResponseStream on the *inference
          // profile* ARN, which in turn fans out to foundation-model ARNs in
          // each Region the profile covers. Both resource patterns are
          // required - confirmed live: granting only foundation-model/*
          // still 403s on the inference-profile ARN.
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: [
            'arn:aws:bedrock:*::foundation-model/*',
            `arn:aws:bedrock:*:${Stack.of(this).account}:inference-profile/*`,
          ],
        }),
        new iam.PolicyStatement({
          actions: ['bedrock-agentcore:InvokeGateway'],
          resources: [props.gatewayArn],
        }),
        // ---- Observability ----------------------------------------------
        // AgentCore assumes THIS role to emit its own telemetry, so without
        // these the harness silently writes nothing: no log group is ever
        // created and the agent's reasoning, tool calls and token usage are
        // invisible. Verified on a live deploy - with only the two Bedrock
        // statements above, no /aws/bedrock-agentcore/runtimes/* log group
        // appeared for this harness after a dozen invocations, and tool usage
        // had to be reconstructed by correlating the tool Lambdas' own
        // CloudWatch REPORT lines against each CodingAgent task window.
        //
        // Since July 2026 AgentCore delivers unified observability - traces,
        // prompts, structured logs and stdout all land in one per-agent log
        // group, /aws/bedrock-agentcore/runtimes/<agent_id>-<endpoint>, rather
        // than splitting spans into the shared aws/spans group. Nothing needs
        // to be enabled on the CfnHarness resource itself (it exposes no
        // observability property); it is entirely IAM-gated, which is why
        // these statements ARE the feature switch.
        //
        // Mirrors the execution role in the official AgentCore harness +
        // Step Functions sample (01-features/01-harness/01-advanced-examples/
        // 06-async-step-function/cloudformation.yaml).
        new iam.PolicyStatement({
          sid: 'XRayTracingAccess',
          actions: [
            'xray:PutTraceSegments',
            'xray:PutTelemetryRecords',
            'xray:GetSamplingRules',
            'xray:GetSamplingTargets',
          ],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          sid: 'CloudWatchLogsGroup',
          actions: ['logs:CreateLogGroup', 'logs:DescribeLogStreams'],
          resources: [
            `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:/aws/bedrock-agentcore/runtimes/*`,
          ],
        }),
        new iam.PolicyStatement({
          sid: 'CloudWatchLogsDescribeGroups',
          // DescribeLogGroups cannot be scoped to a single group - the API
          // lists across the account, so a narrower resource denies the call.
          actions: ['logs:DescribeLogGroups'],
          resources: [
            `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:*`,
          ],
        }),
        new iam.PolicyStatement({
          sid: 'CloudWatchLogsStream',
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [
            `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`,
          ],
        }),
        new iam.PolicyStatement({
          sid: 'CloudWatchMetricsPublish',
          actions: ['cloudwatch:PutMetricData'],
          resources: ['*'],
          conditions: {
            StringEquals: { 'cloudwatch:namespace': 'bedrock-agentcore' },
          },
        }),
      ],
    });
    executionRolePolicy.attachToRole(executionRole);

    this.codingHarness = new agentcore.CfnHarness(this, 'CodingHarness', {
      harnessName: 'MedicalCodingHarness',
      executionRoleArn: executionRole.roleArn,
      model: {
        bedrockModelConfig: {
          modelId: 'us.anthropic.claude-sonnet-4-6',
        },
      },
      memory: { disabled: {} },
    });

    this.codingHarness.node.addDependency(executionRolePolicy);
  }
}

import { Construct } from 'constructs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import * as path from 'path';

export interface CodingStateMachineProps {
  codingHarness: agentcore.CfnHarness;
  gatewayArn: string;
  checkDirectFn: lambda.Function;
  writeBackFn: lambda.Function;
}

/**
 * Loads the coding workflow from state-machine/coding-workflow.asl.yaml,
 * converts it to the JSON the Step Functions API requires, and substitutes
 * resource ARNs at deploy time.
 */
export class CodingStateMachine extends Construct {
  public readonly codingWorkflow: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: CodingStateMachineProps) {
    super(scope, id);

    const aslPath = path.join(__dirname, '../../state-machine/coding-workflow.asl.yaml');
    const definition = JSON.stringify(parseYaml(readFileSync(aslPath, 'utf-8')));

    this.codingWorkflow = new sfn.StateMachine(this, 'CodingWorkflow', {
      stateMachineName: 'MedicalCodingWorkflow',
      definitionBody: sfn.DefinitionBody.fromString(definition),
      definitionSubstitutions: {
        CheckDirectFunctionArn: props.checkDirectFn.functionArn,
        WriteBackFunctionArn: props.writeBackFn.functionArn,
        CodingHarnessArn: props.codingHarness.attrArn,
        GatewayArn: props.gatewayArn,
      },
      logs: {
        destination: new logs.LogGroup(this, 'CodingWorkflowLogs', {
          retention: logs.RetentionDays.ONE_WEEK,
        }),
        level: sfn.LogLevel.ALL,
      },
    });

    for (const fn of [props.checkDirectFn, props.writeBackFn]) {
      fn.grantInvoke(this.codingWorkflow);
    }

    // Both actions are required per AWS's documented IAM policy for invoking
    // a harness from Step Functions - InvokeHarness alone 403s with
    // "no identity-based policy allows the bedrock-agentcore:InvokeAgentRuntime
    // action" (confirmed via a live deploy).
    this.codingWorkflow.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeHarness', 'bedrock-agentcore:InvokeAgentRuntime'],
        resources: [props.codingHarness.attrArn],
      })
    );
  }
}

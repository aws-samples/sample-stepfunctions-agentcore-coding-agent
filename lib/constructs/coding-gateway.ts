import { Construct } from 'constructs';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export interface CodingGatewayProps {
  weatherToolFn: lambda.Function;
}

/**
 * AgentCore Gateway fronting the CodingAgent's single placeholder tool
 * (get_weather). IAM inbound auth: the caller is the harness's own execution
 * role invoking server-side, not an end-user browser session - no user pool
 * needed.
 */
export class CodingGateway extends Construct {
  public readonly gateway: agentcore.Gateway;

  constructor(scope: Construct, id: string, props: CodingGatewayProps) {
    super(scope, id);

    this.gateway = new agentcore.Gateway(this, 'Gateway', {
      gatewayName: 'medical-coding-demo-gateway',
      description: 'MCP tool access for the coding agent (sample)',
      authorizerConfiguration: agentcore.GatewayAuthorizer.usingAwsIam(),
    });

    this.gateway.addLambdaTarget('WeatherTarget', {
      gatewayTargetName: 'get-weather',
      description: 'Placeholder tool returning a static temperature value',
      lambdaFunction: props.weatherToolFn,
      toolSchema: agentcore.ToolSchema.fromInline([
        {
          name: 'get_weather',
          description: 'Get the current weather',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {},
          },
        },
      ]),
    });
  }
}

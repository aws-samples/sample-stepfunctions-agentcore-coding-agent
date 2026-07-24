import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CodingDatabase } from './constructs/coding-database';
import { CodingLambdas } from './constructs/coding-lambdas';
import { CodingGateway } from './constructs/coding-gateway';
import { CodingHarness } from './constructs/coding-harness';
import { CodingStateMachine } from './constructs/coding-state-machine';

export class CodingStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const database = new CodingDatabase(this, 'CodingDatabase');

    const lambdas = new CodingLambdas(this, 'CodingLambdas', { database });

    const gateway = new CodingGateway(this, 'CodingGateway', {
      dictionarySearchFn: lambdas.dictionarySearchFn,
    });

    const harness = new CodingHarness(this, 'CodingHarness', {
      gatewayArn: gateway.gateway.gatewayArn,
    });

    const stateMachine = new CodingStateMachine(this, 'CodingStateMachine', {
      codingHarness: harness.codingHarness,
      gatewayArn: gateway.gateway.gatewayArn,
      checkDirectFn: lambdas.checkDirectFn,
      writeBackFn: lambdas.writeBackFn,
    });

    // Consumed by scripts/seed.py (schema creation + fixture data +
    // embeddings via the RDS Data API) and by manual testing.
    new CfnOutput(this, 'DbClusterArn', { value: database.cluster.clusterArn });
    new CfnOutput(this, 'DbSecretArn', { value: database.cluster.secret!.secretArn });
    new CfnOutput(this, 'DbName', { value: CodingDatabase.DATABASE_NAME });
    new CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.codingWorkflow.stateMachineArn,
    });
  }
}

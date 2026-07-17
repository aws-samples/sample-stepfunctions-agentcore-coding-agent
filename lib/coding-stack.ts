import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CodingLambdas } from './constructs/coding-lambdas';
import { CodingGateway } from './constructs/coding-gateway';
import { CodingHarness } from './constructs/coding-harness';
import { CodingStateMachine } from './constructs/coding-state-machine';

export class CodingStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const lambdas = new CodingLambdas(this, 'CodingLambdas');

    const gateway = new CodingGateway(this, 'CodingGateway', {
      weatherToolFn: lambdas.weatherToolFn,
    });

    const harness = new CodingHarness(this, 'CodingHarness', {
      gatewayArn: gateway.gateway.gatewayArn,
    });

    new CodingStateMachine(this, 'CodingStateMachine', {
      codingHarness: harness.codingHarness,
      gatewayArn: gateway.gateway.gatewayArn,
      checkDirectFn: lambdas.checkDirectFn,
      finalizeFn: lambdas.finalizeFn,
    });
  }
}

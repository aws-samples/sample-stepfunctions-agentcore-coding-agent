import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Duration } from 'aws-cdk-lib';
import * as path from 'path';

/**
 * Lambdas backing the simplified medical-coding-only workflow: a direct-query
 * placeholder, the Gateway-fronted weather tool, and a finalize step. No
 * parameters are passed between states yet - real shapes are still being
 * decided.
 */
export class CodingLambdas extends Construct {
  public readonly checkDirectFn: nodejs.NodejsFunction;
  public readonly weatherToolFn: nodejs.NodejsFunction;
  public readonly finalizeFn: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const commonProps: Partial<nodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(30),
      bundling: { minify: true, sourceMap: true },
    };

    const fn = (constructId: string, functionName: string, relativeDir: string) =>
      new nodejs.NodejsFunction(this, constructId, {
        ...commonProps,
        functionName,
        entry: path.join(__dirname, `../../lambda/${relativeDir}/index.ts`),
      } as nodejs.NodejsFunctionProps);

    this.checkDirectFn = fn('CheckDirectFn', 'coding-demo-check-direct', 'checkDirect');
    this.weatherToolFn = fn('WeatherToolFn', 'coding-demo-tool-weather', 'tools/weather');
    this.finalizeFn = fn('FinalizeFn', 'coding-demo-finalize', 'finalize');
  }
}

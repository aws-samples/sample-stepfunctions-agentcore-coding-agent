import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Duration, Stack } from 'aws-cdk-lib';
import * as path from 'path';
import { CodingDatabase } from './coding-database';

export interface CodingLambdasProps {
  database: CodingDatabase;
}

/**
 * Lambdas backing the medical-coding workflow: the deterministic direct
 * lookup (terms-not-to-autocode block-list + exact/synonym match), the two
 * Gateway-fronted agent tools (pgvector dictionary search and study-metadata
 * lookup), and the write-back step that persists the coding outcome onto the
 * study_terms row. All database access goes through the RDS Data API (no VPC
 * attachment) - see lib/constructs/coding-database.ts.
 */
export class CodingLambdas extends Construct {
  public readonly checkDirectFn: nodejs.NodejsFunction;
  public readonly dictionarySearchFn: nodejs.NodejsFunction;
  public readonly studyInfoFn: nodejs.NodejsFunction;
  public readonly writeBackFn: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: CodingLambdasProps) {
    super(scope, id);

    const cluster = props.database.cluster;

    const dbEnvironment = {
      DB_CLUSTER_ARN: cluster.clusterArn,
      DB_SECRET_ARN: cluster.secret!.secretArn,
      DB_NAME: CodingDatabase.DATABASE_NAME,
    };

    const commonProps: Partial<nodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(30),
      bundling: { minify: true, sourceMap: true },
    };

    const fn = (
      constructId: string,
      functionName: string,
      relativeDir: string,
      environment?: Record<string, string>
    ) =>
      new nodejs.NodejsFunction(this, constructId, {
        ...commonProps,
        functionName,
        entry: path.join(__dirname, `../../lambda/${relativeDir}/index.ts`),
        environment,
      } as nodejs.NodejsFunctionProps);

    this.checkDirectFn = fn(
      'CheckDirectFn',
      'coding-demo-check-direct',
      'checkDirect',
      dbEnvironment
    );
    this.dictionarySearchFn = fn(
      'DictionarySearchFn',
      'coding-demo-tool-dictionary-search',
      'tools/dictionarySearch',
      dbEnvironment
    );
    this.studyInfoFn = fn(
      'StudyInfoFn',
      'coding-demo-tool-study-info',
      'tools/studyInfo',
      dbEnvironment
    );
    this.writeBackFn = fn(
      'WriteBackFn',
      'coding-demo-write-back',
      'writeBack',
      dbEnvironment
    );

    // Data API + secret read - all four functions touch the database
    // (writeBack updates study_terms in place; studyInfo reads
    // study_metadata).
    for (const dbFn of [
      this.checkDirectFn,
      this.dictionarySearchFn,
      this.studyInfoFn,
      this.writeBackFn,
    ]) {
      cluster.grantDataApiAccess(dbFn);
    }

    // Titan Text Embeddings v2 for query-time embedding. A plain foundation
    // model (not a cross-region inference profile), so a single
    // foundation-model ARN suffices - unlike the harness's Claude model (see
    // coding-harness.ts).
    this.dictionarySearchFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${Stack.of(this).region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      })
    );
  }
}

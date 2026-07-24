import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';

/**
 * Aurora PostgreSQL (Serverless v2) cluster holding both the relational
 * medical-coding reference tables (dictionary, synonym list, do-not-autocode
 * list) and their vector embeddings via pgvector - per the agreed design,
 * vectors live in the same table as the source rows (an extra vector column)
 * instead of a separate vector store.
 *
 * The RDS Data API is enabled so every consumer (the workflow Lambdas and the
 * local seed script) talks to the cluster over HTTPS with IAM auth - no VPC
 * attachment, connection pooling, or bastion host needed. That also lets the
 * VPC stay minimal: isolated subnets only, no NAT gateways (nothing in the
 * VPC needs internet egress).
 *
 * Schema creation and seeding are intentionally NOT provisioned here (no
 * custom resource): per the current plan, a local Python script
 * (scripts/seed.py) creates the pgvector extension, tables, fixture rows, and
 * embeddings through the Data API after deploy. CDC-driven embedding
 * generation (design item #2) is deferred.
 *
 * Demo posture: min capacity 0 ACU (auto-pause when idle) and
 * RemovalPolicy.DESTROY - this is illustrative sample infrastructure, not
 * production (see docs/DISCLAIMER.md).
 */
export class CodingDatabase extends Construct {
  public readonly cluster: rds.DatabaseCluster;

  /** Default database created in the cluster; all coding tables live here. */
  public static readonly DATABASE_NAME = 'coding';

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    this.cluster = new rds.DatabaseCluster(this, 'Cluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        // 16.x supports both pgvector and the Data API on Serverless v2;
        // >= 16.3 additionally allows scaling to 0 ACU (auto-pause).
        version: rds.AuroraPostgresEngineVersion.VER_16_8,
      }),
      writer: rds.ClusterInstance.serverlessV2('Writer'),
      serverlessV2MinCapacity: 0,
      serverlessV2MaxCapacity: 2,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      defaultDatabaseName: CodingDatabase.DATABASE_NAME,
      enableDataApi: true,
      credentials: rds.Credentials.fromGeneratedSecret('coding_admin'),
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}

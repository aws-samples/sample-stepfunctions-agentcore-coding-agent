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
 * custom resource): per the current plan, a local seed script
 * (scripts/seed.ts, run via `npm run seed`) creates the pgvector extension,
 * tables, fixture rows, and embeddings through the Data API after deploy.
 * CDC-driven embedding
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
      // min 0.5 ACU, not 0. Scaling to zero is cheaper at idle but makes the
      // first request after a pause pay a multi-second resume: a live burst of
      // 12 concurrent executions against a freshly created 0-ACU cluster
      // produced 7 Lambda timeouts and 1 `ThrottlingException: insufficient
      // resources on the database`. 0.5 keeps the sample responsive and
      // reproducible on a first run, which matters more here than the idle
      // saving. Set this back to 0 if you would rather optimise for cost and
      // accept a slow, occasionally failing first invocation.
      serverlessV2MinCapacity: 0.5,
      // 2 ACU is enough for this fixture but is the other half of the burst
      // failure above - concurrent HNSW queries contend for it. Raise this
      // before running the workflow at any real volume.
      serverlessV2MaxCapacity: 2,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      defaultDatabaseName: CodingDatabase.DATABASE_NAME,
      enableDataApi: true,
      credentials: rds.Credentials.fromGeneratedSecret('coding_admin'),
      // Encryption at rest with the AWS-managed key for RDS.
      //
      // This is NOT redundant: before it was set, the deployed cluster was
      // verified to be `StorageEncrypted: false`. Aurora Serverless v2 did not
      // default encryption on here, so the sample was shipping an unencrypted
      // database in a clinical-data context. Verified after the fix:
      // StorageEncrypted true with a KMS key ARN.
      //
      // Note this does NOT silence CloudFormation-Validate W9008 ("RDS
      // instance should have StorageEncrypted set to true"). That warning
      // targets the AWS::RDS::DBInstance writer, where StorageEncrypted is
      // unset - which is correct for Aurora, because encryption is a
      // cluster-level property. The warning is a false positive for the
      // instance and will persist; see docs/KNOWN-ISSUES.md.
      //
      // Swap in a customer-managed KMS key here if your key policy requires
      // one. Changing this setting on an existing deployment REPLACES the
      // cluster - safe for this sample since all data is reseedable via
      // `npm run seed`.
      storageEncrypted: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}

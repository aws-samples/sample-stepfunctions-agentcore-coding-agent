import {
  RDSDataClient,
  ExecuteStatementCommand,
  SqlParameter,
} from '@aws-sdk/client-rds-data';

/**
 * Thin RDS Data API wrapper shared by the workflow Lambdas. Cluster/secret
 * ARNs and database name come from environment variables set by the CDK
 * stack (see lib/constructs/coding-lambdas.ts). The Data API is used instead
 * of a direct Postgres connection so Lambdas stay out of the VPC - see
 * lib/constructs/coding-database.ts for the rationale.
 */
const client = new RDSDataClient({});

export interface Row {
  [column: string]: string | number | boolean | null;
}

export const executeStatement = async (
  sql: string,
  parameters: SqlParameter[] = []
): Promise<Row[]> => {
  const result = await client.send(
    new ExecuteStatementCommand({
      resourceArn: requireEnv('DB_CLUSTER_ARN'),
      secretArn: requireEnv('DB_SECRET_ARN'),
      database: requireEnv('DB_NAME'),
      sql,
      parameters,
      includeResultMetadata: true,
    })
  );

  const columns = (result.columnMetadata ?? []).map((c) => c.name ?? '');
  return (result.records ?? []).map((record) => {
    const row: Row = {};
    record.forEach((field, i) => {
      row[columns[i]] =
        field.stringValue ??
        field.longValue ??
        field.doubleValue ??
        field.booleanValue ??
        null;
    });
    return row;
  });
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

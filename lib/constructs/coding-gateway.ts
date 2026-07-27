import { Construct } from 'constructs';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export interface CodingGatewayProps {
  dictionarySearchFn: lambda.Function;
  studyInfoFn: lambda.Function;
}

/**
 * AgentCore Gateway fronting the CodingAgent's two tools:
 *   - search_dictionary - pgvector similarity search over the dictionary
 *   - get_study_info    - study metadata lookup, used to break ties between
 *                         candidates that similarity search cannot separate
 *
 * IAM inbound auth: the caller is the harness's own execution role invoking
 * server-side, not an end-user browser session - no user pool needed.
 *
 * Each tool gets its OWN target because addLambdaTarget binds exactly one
 * Lambda per target - adding get_study_info to the search-dictionary target's
 * schema would route its calls to the dictionary-search Lambda.
 *
 * The fully-qualified MCP tool name the harness must reference in
 * AllowedTools is "{gatewayTargetName}___{tool name}" (triple underscore):
 * "search-dictionary___search_dictionary" and
 * "study-info___get_study_info" - see the AllowedTools comment in
 * state-machine/coding-workflow.asl.yaml for the naming pitfall this avoids.
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

    this.gateway.addLambdaTarget('DictionarySearchTarget', {
      gatewayTargetName: 'search-dictionary',
      description:
        'Vector similarity search over the medical coding dictionary (pgvector)',
      lambdaFunction: props.dictionarySearchFn,
      toolSchema: agentcore.ToolSchema.fromInline([
        {
          name: 'search_dictionary',
          description:
            'Semantic search over the coding dictionary (MedDRA or WHODrug). ' +
            'Embeds the verbatim term and returns the top-k closest dictionary ' +
            'entries with their full code hierarchy and a 0-1 similarity score.',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              verbatim_term: {
                type: agentcore.SchemaDefinitionType.STRING,
                description: 'The verbatim term to code, exactly as reported.',
              },
              dictionary: {
                type: agentcore.SchemaDefinitionType.STRING,
                description: 'The coding dictionary: "MedDRA" or "WHODrug".',
              },
              dictionary_version: {
                type: agentcore.SchemaDefinitionType.STRING,
                description: 'The dictionary version, e.g. "v27.0" or "GLOBAL-2024".',
              },
              top_k: {
                type: agentcore.SchemaDefinitionType.INTEGER,
                description: 'Number of candidate matches to return (default 5, max 25).',
              },
            },
            required: ['verbatim_term', 'dictionary', 'dictionary_version'],
          },
        },
      ]),
    });

    this.gateway.addLambdaTarget('StudyInfoTarget', {
      gatewayTargetName: 'study-info',
      description: 'Study metadata lookup for disambiguating candidate terms',
      lambdaFunction: props.studyInfoFn,
      toolSchema: agentcore.ToolSchema.fromInline([
        {
          name: 'get_study_info',
          description:
            'Returns the study name and its free-text metadata description ' +
            '(therapeutic area, adverse events of special interest, expected ' +
            'concomitant medications). Use it to decide which of the candidate ' +
            'dictionary terms best fits the clinical context of this study. It ' +
            'returns context only - never dictionary codes.',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              study_name: {
                type: agentcore.SchemaDefinitionType.STRING,
                description:
                  'The study name/identifier to look up, e.g. "ONCO-2024-01".',
              },
            },
            required: ['study_name'],
          },
        },
      ]),
    });
  }
}

#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CodingStack } from '../lib/coding-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

new CodingStack(app, 'MedicalCodingAgentCoreDemo', {
  description:
    'Illustrative sample: orchestrating deterministic and agentic AI workflows ' +
    'with AWS Step Functions and Amazon Bedrock AgentCore (medical coding scenario). ' +
    'See docs/DISCLAIMER.md.',
  env,
});

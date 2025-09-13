#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { EncodingStack } from "../lib/encoding-stack";

const app = new cdk.App();

// Get environment from context or default to dev
const environment = app.node.tryGetContext("environment") || "dev";
const region = app.node.tryGetContext("region") || "us-east-1";

new EncodingStack(app, `SesamyEncodingStack-${environment}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: region,
  },
  environment: environment,

  // Stack tags
  tags: {
    Project: "sesamy-encoding",
    Environment: environment,
    Service: "ffmpeg-lambda",
  },
});

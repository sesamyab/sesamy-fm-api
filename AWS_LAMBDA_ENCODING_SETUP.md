# AWS Lambda Encoding Configuration for Workflows

## Overview

The audio processing workflow now uses the AWS Lambda encoding service for audio encoding operations. This document explains how to configure and use the AWS Lambda service.

## Configuration

### 1. Set Environment Variables in wrangler.toml

The workflow will automatically use AWS Lambda when configured:

```toml
[vars]
# Use AWS Lambda for encoding (instead of Cloudflare Container)
ENCODING_SERVICE_PROVIDER = "aws"
```

### 2. Set Secrets

You need to set the Lambda function URL and optionally an API key as secrets:

```bash
# Set the Lambda Function URL (get this from CDK deployment outputs)
wrangler secret put AWS_LAMBDA_ENCODING_URL

# Optional: Set API key if your Lambda requires authentication
wrangler secret put AWS_LAMBDA_API_KEY
```

### 3. Get Lambda URL from CDK Deployment

After deploying the CDK stack, get the Lambda function URL:

```bash
cd cdk
npm run deploy

# The output will show:
# Outputs:
# SesamyEncodingStack-dev.LambdaFunctionUrl = https://xxxxx.lambda-url.us-east-1.on.aws
```

Or retrieve it later:

```bash
aws cloudformation describe-stacks \
  --stack-name SesamyEncodingStack-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`LambdaFunctionUrl`].OutputValue' \
  --output text
```

## How It Works

### Audio Processing Workflow

The `tts-encode.ts` step in the audio processing workflow automatically:

1. Checks the `ENCODING_SERVICE_PROVIDER` environment variable
2. If set to `"aws"` and `AWS_LAMBDA_ENCODING_URL` is configured:
   - Uses AWS Lambda encoding service
   - Passes R2 credentials to Lambda for direct S3-compatible access
3. If set to `"cloudflare"` or if AWS is not configured:
   - Falls back to Cloudflare Container encoding

### EncodingService Abstraction

The workflow uses the `EncodingService` class which provides a unified interface:

```typescript
// Automatically configured based on environment
const encodingService = new EncodingService({
  type: "aws-lambda",
  awsLambda: {
    functionUrl: env.AWS_LAMBDA_ENCODING_URL,
    apiKey: env.AWS_LAMBDA_API_KEY,
  },
});

// Encode audio
const result = await encodingService.encode({
  audioUrl: inputAudioUrl,
  outputUrl: outputAudioUrl,
  outputFormat: "opus",
  bitrate: 24,
  r2AccessKeyId: env.R2_ACCESS_KEY_ID,
  r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY,
  storageEndpoint: env.R2_ENDPOINT,
});
```

## Testing

### 1. Test the Lambda Function Directly

```bash
# Health check
curl https://your-lambda-url.lambda-url.us-east-1.on.aws/

# Test encoding with sample audio
curl -X POST https://your-lambda-url.lambda-url.us-east-1.on.aws/test \
  -H "Content-Type: application/json" \
  -d '{
    "outputFormat": "mp3",
    "bitrate": 128
  }'
```

### 2. Test via Workflow

Trigger an audio processing workflow and verify it uses AWS Lambda:

```bash
# Check workflow logs for "Using AWS Lambda encoding service"
wrangler tail
```

The logs should show:

```
Using AWS Lambda encoding service
```

### 3. Monitor Lambda Execution

```bash
# Tail Lambda logs
aws logs tail /aws/lambda/sesamy-encoding-dev --follow

# Or in CloudWatch console
# Go to: CloudWatch → Log Groups → /aws/lambda/sesamy-encoding-dev
```

## Benefits of AWS Lambda

1. **More Resources**: Lambda provides up to 10GB memory and 15-minute timeout
2. **No Cold Starts**: Function URLs with provisioned concurrency
3. **Full FFmpeg**: Complete FFmpeg binary with all codecs
4. **Better Performance**: Native execution without WebAssembly overhead
5. **Scalability**: Automatic scaling based on demand
6. **Cost Effective**: Pay only for actual execution time

## Environment Variables Summary

| Variable                    | Type   | Required | Description                                              |
| --------------------------- | ------ | -------- | -------------------------------------------------------- |
| `ENCODING_SERVICE_PROVIDER` | Var    | No       | Set to `"aws"` to use Lambda (default) or `"cloudflare"` |
| `AWS_LAMBDA_ENCODING_URL`   | Secret | Yes\*    | Lambda function URL from CDK deployment                  |
| `AWS_LAMBDA_API_KEY`        | Secret | No       | Optional API key for secured access                      |
| `R2_ACCESS_KEY_ID`          | Secret | Yes      | R2 access key (passed to Lambda)                         |
| `R2_SECRET_ACCESS_KEY`      | Secret | Yes      | R2 secret key (passed to Lambda)                         |
| `R2_ENDPOINT`               | Var    | Yes      | R2 endpoint URL                                          |

\*Required when `ENCODING_SERVICE_PROVIDER` is set to `"aws"`

## Troubleshooting

### Issue: Workflow fails with "Invalid encoding service configuration"

**Solution**: Ensure AWS_LAMBDA_ENCODING_URL is set:

```bash
wrangler secret put AWS_LAMBDA_ENCODING_URL
# Paste the Lambda URL
```

### Issue: Lambda returns 403 or authentication error

**Solution**: Check R2 credentials are correct and have proper permissions:

```bash
# Verify R2 credentials
wrangler secret list

# Re-set if needed
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

### Issue: Encoding times out

**Solution**:

1. Check Lambda timeout configuration (should be 15 minutes)
2. Verify network connectivity between Lambda and R2
3. Check CloudWatch logs for detailed error messages

### Issue: Lambda cold starts are slow

**Solution**:

1. Consider enabling provisioned concurrency in CDK stack
2. Or use AWS Lambda SnapStart (if using Java runtime)
3. Current Node.js implementation typically has <1s cold start

## Switching Between Providers

### Switch to AWS Lambda

```bash
# Update wrangler.toml
ENCODING_SERVICE_PROVIDER = "aws"

# Deploy
wrangler deploy
```

### Switch to Cloudflare Container

```bash
# Update wrangler.toml
ENCODING_SERVICE_PROVIDER = "cloudflare"

# Deploy
wrangler deploy
```

## Cost Estimation

### AWS Lambda Costs

Based on typical podcast episode encoding (60 min audio):

- Memory: 10GB
- Duration: ~30-60 seconds
- Cost per encoding: ~$0.01-0.02
- Monthly (1000 episodes): ~$10-20

### Cloudflare Container Costs

- Included in Workers Paid plan ($5/month)
- Additional CPU time charges may apply for heavy workloads
- Cost per encoding: Varies based on CPU time

## Next Steps

1. Deploy or verify CDK stack deployment
2. Set the Lambda URL secret in Wrangler
3. Update `ENCODING_SERVICE_PROVIDER` to `"aws"` in wrangler.toml
4. Deploy the worker: `wrangler deploy`
5. Test the workflow with a sample episode
6. Monitor Lambda logs to verify correct operation

## Additional Resources

- [CDK Deployment Guide](./cdk/README.md)
- [Encoding Service Documentation](./ENCODING_SERVICE.md)
- [Audio Processing Workflow](./AUDIO_PROCESSING_TRANSCRIPTION.md)

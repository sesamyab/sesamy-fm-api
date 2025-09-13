# AWS CDK FFmpeg Encoding Service

This directory contains the AWS CDK deployment configuration for running the FFmpeg encoding service on AWS Lambda with container images.

## 🚀 Quick Start

### Prerequisites

1. **AWS CLI v2** installed and configured

   ```bash
   # Install AWS CLI v2 (required for SSO)
   # macOS: brew install awscli
   # Linux: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
   ```

2. **AWS Authentication** - Choose one:

   **Option A: AWS SSO (Recommended for Google accounts)**

   ```bash
   # Quick setup
   ./sso-setup.sh setup
   ./sso-setup.sh login
   export AWS_PROFILE=sesamy-sso
   ```

   **Option B: Traditional credentials**

   ```bash
   aws configure
   ```

3. **Node.js** (version 18 or later)

4. **AWS CDK** installed globally

   ```bash
   npm install -g aws-cdk
   ```

5. **Docker** for building container images

### Deploy

1. **Set up AWS SSO (if using Google accounts)**

   ```bash
   # From project root
   ./sso-setup.sh setup    # Configure SSO profile
   ./sso-setup.sh login    # Test authentication
   export AWS_PROFILE=sesamy-sso  # Use the SSO profile
   ```

2. **Navigate to the CDK directory**

   ```bash
   cd cdk
   ```

3. **Run the deployment script**

   ```bash
   ./deploy.sh
   ```

   Or for a specific environment:

   ```bash
   ENVIRONMENT=prod AWS_PROFILE=sesamy-sso ./deploy.sh
   ```

That's it! The script will handle everything:

- Check SSO authentication
- Install dependencies
- Bootstrap CDK (if needed)
- Deploy infrastructure
- Build and push Docker image
- Update Lambda function
- Test the deployment

## 🛠 Manual Commands

If you prefer to run commands manually:

### 1. Install Dependencies

```bash
cd cdk
npm install
```

### 2. Bootstrap CDK (first time only)

```bash
cdk bootstrap
```

### 3. Deploy the Stack

```bash
npm run build
cdk deploy --context environment=dev
```

### 4. Build and Push Docker Image

```bash
# Get ECR URI from stack outputs
ECR_URI=$(aws cloudformation describe-stacks \
  --stack-name SesamyEncodingStack-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`ECRRepositoryUri`].OutputValue' \
  --output text)

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $ECR_URI

# Build and push
docker build -f ../Dockerfile.lambda -t sesamy-encoding-lambda ..
docker tag sesamy-encoding-lambda:latest $ECR_URI:latest
docker push $ECR_URI:latest
```

### 5. Update Lambda Function

```bash
aws lambda update-function-code \
  --function-name sesamy-encoding-dev \
  --image-uri $ECR_URI:latest
```

## 📋 Stack Resources

The CDK stack creates:

### Core Resources

- **ECR Repository**: Container image storage
- **Lambda Function**: FFmpeg processing (10GB memory, 15min timeout)
- **Lambda Function URL**: Direct HTTP access
- **IAM Role**: Lambda execution permissions
- **CloudWatch Log Group**: Function logs

### Optional Resources

- **API Gateway**: REST API with custom domain support
- **CloudWatch Dashboard**: Monitoring and metrics

### Outputs

- `ECRRepositoryUri`: Container registry URL
- `LambdaFunctionName`: Function name
- `LambdaFunctionUrl`: Direct function URL
- `ApiGatewayUrl`: API Gateway endpoint
- `DashboardUrl`: CloudWatch dashboard

## 🔧 Configuration

### Environment Variables

Set these before deployment:

```bash
export ENVIRONMENT=dev        # dev, staging, prod
export AWS_REGION=us-east-1   # AWS region
```

### CDK Context

You can also pass context values:

```bash
cdk deploy --context environment=prod --context region=us-west-2
```

### Lambda Configuration

The function is configured with maximum resources:

- **Memory**: 10,240 MB (maximum)
- **Timeout**: 15 minutes (maximum)
- **Ephemeral Storage**: 10 GB (maximum)
- **Architecture**: x86_64 (for FFmpeg compatibility)

## 🌐 API Endpoints

After deployment, test your endpoints:

### Health Check

```bash
curl https://your-lambda-url.lambda-url.us-east-1.on.aws/
```

### Test Encoding

```bash
curl -X POST https://your-lambda-url.lambda-url.us-east-1.on.aws/test \
  -H "Content-Type: application/json" \
  -d '{"outputFormat": "mp3", "bitrate": 128}'
```

### Audio Metadata

```bash
curl -X POST https://your-lambda-url.lambda-url.us-east-1.on.aws/metadata \
  -H "Content-Type: application/json" \
  -d '{"audioUrl": "https://example.com/audio.wav"}'
```

### Audio Encoding

```bash
curl -X POST https://your-lambda-url.lambda-url.us-east-1.on.aws/encode \
  -H "Content-Type: application/json" \
  -d '{
    "audioUrl": "https://example.com/input.wav",
    "outputUrl": "https://example.com/output.mp3",
    "outputFormat": "mp3",
    "bitrate": 128
  }'
```

## 📊 Monitoring

### CloudWatch Logs

View function logs:

```bash
aws logs tail /aws/lambda/sesamy-encoding-dev --follow
```

### CloudWatch Dashboard

Access the dashboard URL from stack outputs to view:

- Lambda invocations
- Duration metrics
- Error rates
- Memory usage

### Custom Metrics

The function exports custom metrics for:

- Encoding jobs processed
- Processing duration
- Success/failure rates

## 🚨 Troubleshooting

### Common Issues

1. **SSO Authentication Issues**

   - **Token expired**: Run `aws sso login --profile your-profile`
   - **Wrong profile**: Check `echo $AWS_PROFILE` or set correct profile
   - **No SSO profiles**: Run `../sso-setup.sh setup` to configure
   - **CLI version**: Ensure AWS CLI v2 is installed (`aws --version`)

2. **ECR Image Not Found**

   - Ensure Docker image is built and pushed
   - Check ECR repository exists
   - Verify image tag is 'latest'

3. **Lambda Timeout**

   - Maximum timeout is 15 minutes
   - Use chunked processing for very large files
   - Monitor memory usage

4. **Permission Issues**
   - Check IAM role has necessary permissions
   - Verify ECR repository policies
   - Ensure SSO role has sufficient permissions

### Debug Commands

**SSO Authentication**:

```bash
# Check current authentication status
../sso-setup.sh status

# Re-authenticate with SSO
aws sso login --profile sesamy-sso

# List available profiles
aws configure list-profiles

# Check current identity
aws sts get-caller-identity
```

**Stack and Function**:

```bash
# Check stack status
aws cloudformation describe-stacks --stack-name SesamyEncodingStack-dev

# Test function directly
aws lambda invoke \
  --function-name sesamy-encoding-dev \
  --payload '{"httpMethod":"GET","path":"/"}' \
  response.json

# View function configuration
aws lambda get-function --function-name sesamy-encoding-dev
```

## 🔄 Updates

### Update Function Code

After changing the container code:

```bash
./deploy.sh  # Full deployment
```

Or just update the function:

```bash
# Build and push new image
docker build -f ../Dockerfile.lambda -t sesamy-encoding-lambda ..
docker tag sesamy-encoding-lambda:latest $ECR_URI:latest
docker push $ECR_URI:latest

# Update function
aws lambda update-function-code \
  --function-name sesamy-encoding-dev \
  --image-uri $ECR_URI:latest
```

### Update Infrastructure

After changing CDK code:

```bash
npm run build
cdk diff --context environment=dev  # Preview changes
cdk deploy --context environment=dev  # Apply changes
```

## 🗑 Cleanup

### Destroy Stack

```bash
./deploy.sh destroy
```

Or manually:

```bash
cdk destroy --context environment=dev
```

This will remove all resources except:

- ECR images (manually delete if needed)
- CloudWatch logs (retention period applies)

## 💰 Cost Optimization

### Lambda Costs

- **Requests**: $0.0000002 per request
- **Duration**: $0.0000166667 per GB-second

Example for 5-minute encoding job:

- Duration: 300 seconds × 10 GB = 3000 GB-seconds
- Cost: ~$0.05 per job

### Optimization Tips

1. Use provisioned concurrency for consistent performance
2. Implement warmup strategy to reduce cold starts
3. Monitor and optimize memory allocation
4. Use lifecycle policies for ECR images

## 📚 Additional Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [Lambda Container Images](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/operatorguide/)

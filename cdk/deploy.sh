#!/bin/bash

# AWS CDK Manual Deployment Script for FFmpeg Encoding Service
# This script builds and deploys the FFmpeg encoding service to AWS Lambda using CDK

set -e

# Configuration
PROJECT_NAME="sesamy-encoding"
ENVIRONMENT="${ENVIRONMENT:-dev}"
AWS_REGION="${AWS_REGION:-us-east-1}"
DOCKERFILE="../Dockerfile.lambda"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

echo_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

echo_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

echo_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    echo_step "Checking prerequisites..."
    
    if ! command -v aws &> /dev/null; then
        echo_error "AWS CLI is not installed. Please install it first."
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        echo_error "Docker is not installed. Please install it first."
        exit 1
    fi
    
    if ! command -v cdk &> /dev/null; then
        echo_error "AWS CDK is not installed. Please install it first: npm install -g aws-cdk"
        exit 1
    fi
    
    if ! command -v node &> /dev/null; then
        echo_error "Node.js is not installed. Please install it first."
        exit 1
    fi
    
    # Check AWS credentials (supports both SSO and traditional credentials)
    check_aws_credentials
    
    # Check if in CDK directory
    if [ ! -f "cdk.json" ]; then
        echo_error "Please run this script from the cdk directory."
        exit 1
    fi
    
    echo_info "✅ Prerequisites check passed!"
}

# Check AWS credentials and handle SSO
check_aws_credentials() {
    echo_step "Checking AWS authentication..."
    
    # First, try to get caller identity
    if aws sts get-caller-identity &> /dev/null; then
        ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
        USER_ARN=$(aws sts get-caller-identity --query Arn --output text)
        echo_info "✅ AWS credentials valid!"
        echo_info "Account: $ACCOUNT_ID"
        echo_info "Identity: $USER_ARN"
        return 0
    fi
    
    # Check if SSO is configured
    if aws configure list-profiles | grep -q sso; then
        echo_warn "AWS credentials expired or not available."
        echo_info "Detected SSO profiles. Available profiles:"
        aws configure list-profiles | grep -E "(sso|SSO)" || aws configure list-profiles
        echo ""
        echo_info "Please login with SSO. Choose one of the following options:"
        echo_info "1. Login to default SSO profile: aws sso login"
        echo_info "2. Login to specific profile: aws sso login --profile <profile-name>"
        echo_info "3. Set profile for this session: export AWS_PROFILE=<profile-name>"
        echo ""
        echo_warn "After logging in, re-run this script."
        exit 1
    else
        echo_error "AWS credentials not configured."
        echo_info "Please set up AWS authentication using one of these methods:"
        echo_info "1. AWS SSO: aws configure sso"
        echo_info "2. Traditional credentials: aws configure"
        echo_info "3. Environment variables: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY"
        exit 1
    fi
}

# Install dependencies
install_dependencies() {
    echo_step "Installing CDK dependencies..."
    npm install
    echo_info "✅ Dependencies installed!"
}

# Bootstrap CDK (if needed)
bootstrap_cdk() {
    echo_step "Checking CDK bootstrap status..."
    
    # Check if bootstrap is needed
    if ! aws cloudformation describe-stacks --stack-name CDKToolkit --region $AWS_REGION &> /dev/null; then
        echo_warn "CDK bootstrap required for region $AWS_REGION"
        echo_info "Bootstrapping CDK..."
        cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/$AWS_REGION
        echo_info "✅ CDK bootstrapped!"
    else
        echo_info "✅ CDK already bootstrapped!"
    fi
}

# Build CDK
build_cdk() {
    echo_step "Building CDK project..."
    npm run build
    echo_info "✅ CDK project built!"
}

# Deploy infrastructure
deploy_infrastructure() {
    echo_step "Deploying AWS infrastructure with CDK..."
    
    # Show what will be deployed
    echo_info "Synthesizing CDK stack..."
    cdk synth --context environment=$ENVIRONMENT --context region=$AWS_REGION
    
    echo_warn "Review the stack above. Continue with deployment? (y/N)"
    read -r response
    if [[ ! "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        echo_info "Deployment cancelled."
        exit 0
    fi
    
    # Deploy the stack
    echo_info "Deploying CDK stack..."
    cdk deploy \
        --context environment=$ENVIRONMENT \
        --context region=$AWS_REGION \
        --require-approval never \
        --outputs-file cdk-outputs.json
    
    echo_info "✅ Infrastructure deployed!"
}

# Get deployment outputs
get_deployment_outputs() {
    echo_step "Getting deployment outputs..."
    
    if [ -f "cdk-outputs.json" ]; then
        ECR_URI=$(cat cdk-outputs.json | grep -o '"ECRRepositoryUri": "[^"]*' | cut -d'"' -f4)
        LAMBDA_URL=$(cat cdk-outputs.json | grep -o '"LambdaFunctionUrl": "[^"]*' | cut -d'"' -f4)
        API_URL=$(cat cdk-outputs.json | grep -o '"ApiGatewayUrl": "[^"]*' | cut -d'"' -f4)
        FUNCTION_NAME=$(cat cdk-outputs.json | grep -o '"LambdaFunctionName": "[^"]*' | cut -d'"' -f4)
        
        echo_info "📋 Deployment Details:"
        echo_info "ECR Repository: $ECR_URI"
        echo_info "Lambda Function: $FUNCTION_NAME"
        echo_info "Lambda URL: $LAMBDA_URL"
        echo_info "API Gateway URL: $API_URL"
    else
        echo_warn "Could not find deployment outputs file"
        # Fallback to getting outputs from CDK
        ECR_URI=$(cdk list --context environment=$ENVIRONMENT | head -1)
        echo_info "Stack deployed successfully!"
    fi
}

# Build and push Docker image
build_and_push_image() {
    echo_step "Building and pushing Docker image..."
    
    if [ -z "$ECR_URI" ]; then
        echo_error "ECR URI not found. Please check deployment outputs."
        exit 1
    fi
    
    # Login to ECR
    echo_info "Logging into ECR..."
    aws ecr get-login-password --region $AWS_REGION | \
        docker login --username AWS --password-stdin $ECR_URI
    
    # Build the image
    echo_info "Building Docker image..."
    docker build -f $DOCKERFILE -t $PROJECT_NAME-lambda ..
    
    # Tag for ECR
    docker tag $PROJECT_NAME-lambda:latest $ECR_URI:latest
    
    # Push to ECR
    echo_info "Pushing image to ECR..."
    docker push $ECR_URI:latest
    
    echo_info "✅ Image pushed successfully!"
}

# Update Lambda function
update_lambda() {
    echo_step "Updating Lambda function with new image..."
    
    if [ -z "$FUNCTION_NAME" ]; then
        FUNCTION_NAME="sesamy-encoding-$ENVIRONMENT"
    fi
    
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --image-uri $ECR_URI:latest \
        --region $AWS_REGION
    
    echo_info "Waiting for Lambda function to be updated..."
    aws lambda wait function-updated \
        --function-name $FUNCTION_NAME \
        --region $AWS_REGION
    
    echo_info "✅ Lambda function updated successfully!"
}

# Test deployment
test_deployment() {
    echo_step "Testing deployment..."
    
    if [ -z "$LAMBDA_URL" ]; then
        echo_warn "Lambda URL not available, skipping tests"
        return
    fi
    
    # Test health endpoint
    echo_info "Testing health endpoint..."
    response=$(curl -s -w "\n%{http_code}" "$LAMBDA_URL")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        echo_info "✅ Health check passed!"
        echo_info "Response: $body"
    else
        echo_error "❌ Health check failed! HTTP Code: $http_code"
        echo_error "Response: $body"
    fi
    
    # Test encoding endpoint
    echo_info "Testing encoding endpoint..."
    test_response=$(curl -s -X POST "$LAMBDA_URL/test" \
        -H "Content-Type: application/json" \
        -d '{"outputFormat": "mp3", "bitrate": 128}' \
        -w "\n%{http_code}")
    
    test_http_code=$(echo "$test_response" | tail -n1)
    test_body=$(echo "$test_response" | sed '$d')
    
    if [ "$test_http_code" = "200" ]; then
        echo_info "✅ Encoding test passed!"
        echo_info "Response: $test_body"
    else
        echo_error "❌ Encoding test failed! HTTP Code: $test_http_code"
        echo_error "Response: $test_body"
    fi
}

# Show deployment summary
show_summary() {
    echo ""
    echo_info "🎉 Deployment completed successfully!"
    echo ""
    echo_info "📋 Summary:"
    echo_info "Environment: $ENVIRONMENT"
    echo_info "Region: $AWS_REGION"
    echo_info "Lambda Function: ${FUNCTION_NAME:-sesamy-encoding-$ENVIRONMENT}"
    
    if [ -n "$LAMBDA_URL" ]; then
        echo_info "Lambda Function URL: $LAMBDA_URL"
    fi
    
    if [ -n "$API_URL" ]; then
        echo_info "API Gateway URL: $API_URL"
    fi
    
    echo ""
    echo_info "🔗 Useful commands:"
    echo_info "View logs: aws logs tail /aws/lambda/sesamy-encoding-$ENVIRONMENT --follow"
    echo_info "Update function: aws lambda update-function-code --function-name sesamy-encoding-$ENVIRONMENT --image-uri $ECR_URI:latest"
    echo_info "Destroy stack: cdk destroy --context environment=$ENVIRONMENT"
    echo ""
    echo_info "Next steps:"
    echo_info "1. Update your main service to use the Lambda Function URL"
    echo_info "2. Monitor CloudWatch logs for any issues"
    echo_info "3. Set up custom domain with API Gateway if needed"
}

# Main deployment function
main() {
    echo_info "🚀 Starting AWS CDK deployment for FFmpeg Encoding Service"
    echo_info "Project: $PROJECT_NAME"
    echo_info "Environment: $ENVIRONMENT"
    echo_info "Region: $AWS_REGION"
    echo ""
    
    check_prerequisites
    install_dependencies
    bootstrap_cdk
    build_cdk
    deploy_infrastructure
    get_deployment_outputs
    build_and_push_image
    update_lambda
    test_deployment
    show_summary
}

# SSO login helper
sso_login() {
    echo_step "AWS SSO Login"
    
    if [ -n "$AWS_PROFILE" ]; then
        echo_info "Using AWS profile: $AWS_PROFILE"
        aws sso login --profile $AWS_PROFILE
    else
        # List available SSO profiles
        SSO_PROFILES=$(aws configure list-profiles | grep -E "(sso|SSO)" | head -5)
        if [ -n "$SSO_PROFILES" ]; then
            echo_info "Available SSO profiles:"
            echo "$SSO_PROFILES"
            echo ""
            echo_info "Set AWS_PROFILE environment variable or use 'aws sso login --profile <profile-name>'"
            echo_info "Example: export AWS_PROFILE=your-sso-profile"
            echo ""
            # Try to login with the first SSO profile found
            FIRST_SSO_PROFILE=$(echo "$SSO_PROFILES" | head -1)
            echo_warn "Attempting to login with profile: $FIRST_SSO_PROFILE"
            aws sso login --profile $FIRST_SSO_PROFILE
        else
            echo_info "No SSO profiles found. Use 'aws configure sso' to set up SSO."
            aws sso login
        fi
    fi
    
    # Verify login worked
    if aws sts get-caller-identity &> /dev/null; then
        echo_info "✅ SSO login successful!"
    else
        echo_error "❌ SSO login failed. Please try manually: aws sso login --profile <your-profile>"
        exit 1
    fi
}

# Handle command line arguments
case "${1:-deploy}" in
    "deploy")
        main
        ;;
    "destroy")
        echo_warn "This will destroy the entire stack. Are you sure? (y/N)"
        read -r response
        if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
            cdk destroy --context environment=$ENVIRONMENT --force
        fi
        ;;
    "diff")
        npm run build
        cdk diff --context environment=$ENVIRONMENT --context region=$AWS_REGION
        ;;
    "synth")
        npm run build
        cdk synth --context environment=$ENVIRONMENT --context region=$AWS_REGION
        ;;
    "sso-login")
        sso_login
        ;;
    *)
        echo_info "Usage: $0 [deploy|destroy|diff|synth|sso-login]"
        echo_info "  deploy (default) - Deploy the stack"
        echo_info "  destroy - Destroy the stack"
        echo_info "  diff - Show differences"
        echo_info "  synth - Synthesize CloudFormation template"
        echo_info "  sso-login - Login with AWS SSO"
        echo ""
        echo_info "Environment variables:"
        echo_info "  AWS_PROFILE - AWS profile to use (for SSO)"
        echo_info "  ENVIRONMENT - Deployment environment (dev, staging, prod)"
        echo_info "  AWS_REGION - AWS region (default: us-east-1)"
        ;;
esac

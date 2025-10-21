#!/bin/bash

# AWS CDK Lambda Container Deployment Script
# This script builds and deploys the FFmpeg encoding service to AWS Lambda using CDK

set -e

# Configuration
PROJECT_NAME="sesamy-encoding"
ENVIRONMENT="${1:-dev}"  # Default to dev, can be overridden
AWS_REGION="${2:-us-east-1}"
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
    
    if ! command -v node &> /dev/null; then
        echo_error "Node.js is not installed. Please install it first."
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        echo_error "npm is not installed. Please install it first."
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        echo_error "AWS credentials not configured. Please run 'aws configure' first."
        exit 1
    fi
    
    echo_info "Prerequisites check passed!"
}

# Install CDK dependencies
install_dependencies() {
    echo_step "Installing CDK dependencies..."
    
    if [ ! -d "node_modules" ]; then
        npm install
    else
        echo_info "Dependencies already installed."
    fi
    
    # Install CDK globally if not present
    if ! command -v cdk &> /dev/null; then
        echo_info "Installing AWS CDK globally..."
        npm install -g aws-cdk
    fi
}

# Bootstrap CDK (if needed)
bootstrap_cdk() {
    echo_step "Checking CDK bootstrap status..."
    
    # Check if bootstrap is needed
    if ! aws cloudformation describe-stacks --stack-name CDKToolkit --region $AWS_REGION &> /dev/null; then
        echo_info "Bootstrapping CDK for region $AWS_REGION..."
        cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/$AWS_REGION
    else
        echo_info "CDK already bootstrapped for region $AWS_REGION"
    fi
}

# Build TypeScript
build_project() {
    echo_step "Building TypeScript project..."
    npm run build
}

# Deploy infrastructure
deploy_infrastructure() {
    echo_step "Deploying AWS infrastructure with CDK..."
    
    echo_info "Deploying to environment: $ENVIRONMENT"
    echo_info "AWS Region: $AWS_REGION"
    
    # Show diff first
    echo_info "Showing deployment diff..."
    cdk diff --context environment=$ENVIRONMENT --context region=$AWS_REGION || true
    
    echo_warn "Continue with deployment? (y/N)"
    read -r response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        cdk deploy --context environment=$ENVIRONMENT --context region=$AWS_REGION --require-approval never
    else
        echo_info "Deployment cancelled."
        exit 0
    fi
}

# Get ECR repository URL
get_ecr_url() {
    echo_step "Getting ECR repository URL..."
    
    STACK_NAME="SesamyEncodingStack-$ENVIRONMENT"
    ECR_URL=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $AWS_REGION \
        --query "Stacks[0].Outputs[?OutputKey=='ECRRepositoryUri'].OutputValue" \
        --output text)
    
    if [ -z "$ECR_URL" ]; then
        echo_error "Failed to get ECR repository URL from CloudFormation stack"
        exit 1
    fi
    
    echo_info "ECR Repository URL: $ECR_URL"
}

# Build and push Docker image
build_and_push_image() {
    echo_step "Building and pushing Docker image..."
    
    # Login to ECR
    echo_info "Logging into ECR..."
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URL
    
    # Build the image (from parent directory)
    echo_info "Building Docker image..."
    cd ..
    docker build -f $DOCKERFILE -t $PROJECT_NAME-lambda .
    cd cdk
    
    # Tag for ECR
    docker tag $PROJECT_NAME-lambda:latest $ECR_URL:latest
    
    # Push to ECR
    echo_info "Pushing image to ECR..."
    docker push $ECR_URL:latest
    
    echo_info "Image pushed successfully!"
}

# Update Lambda function
update_lambda() {
    echo_step "Updating Lambda function with new image..."
    
    FUNCTION_NAME="$PROJECT_NAME-$ENVIRONMENT"
    
    echo_info "Updating Lambda function: $FUNCTION_NAME"
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --image-uri $ECR_URL:latest \
        --region $AWS_REGION
    
    echo_info "Waiting for Lambda function to be updated..."
    aws lambda wait function-updated \
        --function-name $FUNCTION_NAME \
        --region $AWS_REGION
    
    echo_info "Lambda function updated successfully!"
}

# Test deployment
test_deployment() {
    echo_step "Testing deployment..."
    
    STACK_NAME="SesamyEncodingStack-$ENVIRONMENT"
    
    # Get Lambda Function URL
    LAMBDA_URL=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $AWS_REGION \
        --query "Stacks[0].Outputs[?OutputKey=='LambdaFunctionUrl'].OutputValue" \
        --output text)
    
    # Get API Gateway URL
    API_URL=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $AWS_REGION \
        --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayUrl'].OutputValue" \
        --output text)
    
    echo_info "Testing Lambda Function URL: $LAMBDA_URL"
    
    # Test health endpoint
    echo_info "Testing health endpoint..."
    response=$(curl -s -w "\n%{http_code}" "$LAMBDA_URL" || echo -e "\nERROR")
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
        -w "\n%{http_code}" || echo -e "\nERROR")
    
    test_http_code=$(echo "$test_response" | tail -n1)
    test_body=$(echo "$test_response" | sed '$d')
    
    if [ "$test_http_code" = "200" ]; then
        echo_info "✅ Encoding test passed!"
        echo_info "Response: $test_body"
    else
        echo_error "❌ Encoding test failed! HTTP Code: $test_http_code"
        echo_error "Response: $test_body"
    fi
    
    echo_info ""
    echo_info "🎉 Deployment URLs:"
    echo_info "Lambda Function URL: $LAMBDA_URL"
    echo_info "API Gateway URL: $API_URL"
    
    # Get CloudWatch Dashboard URL
    DASHBOARD_URL=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $AWS_REGION \
        --query "Stacks[0].Outputs[?OutputKey=='DashboardUrl'].OutputValue" \
        --output text)
    
    if [ ! -z "$DASHBOARD_URL" ]; then
        echo_info "CloudWatch Dashboard: $DASHBOARD_URL"
    fi
}

# Show usage
usage() {
    echo "Usage: $0 [environment] [region]"
    echo ""
    echo "Arguments:"
    echo "  environment    Environment to deploy to (dev, staging, prod) [default: dev]"
    echo "  region         AWS region [default: us-east-1]"
    echo ""
    echo "Examples:"
    echo "  $0                    # Deploy to dev in us-east-1"
    echo "  $0 prod               # Deploy to prod in us-east-1"
    echo "  $0 staging eu-west-1  # Deploy to staging in eu-west-1"
    exit 1
}

# Main deployment function
main() {
    # Check for help flag
    if [[ "$1" == "-h" || "$1" == "--help" ]]; then
        usage
    fi
    
    echo_info "🚀 Starting AWS CDK deployment for FFmpeg Encoding Service"
    echo_info "Project: $PROJECT_NAME"
    echo_info "Environment: $ENVIRONMENT"
    echo_info "Region: $AWS_REGION"
    echo_info ""
    
    check_prerequisites
    install_dependencies
    bootstrap_cdk
    build_project
    deploy_infrastructure
    get_ecr_url
    build_and_push_image
    update_lambda
    test_deployment
    
    echo_info ""
    echo_info "🎉 CDK deployment completed successfully!"
    echo_info ""
    echo_info "Next steps:"
    echo_info "1. Update your main service to use the Lambda Function URL"
    echo_info "2. Monitor CloudWatch logs and dashboard for any issues"
    echo_info "3. Consider setting up custom domain with API Gateway"
    echo_info ""
    echo_info "Useful commands:"
    echo_info "  cdk diff --context environment=$ENVIRONMENT    # Show changes"
    echo_info "  cdk destroy --context environment=$ENVIRONMENT # Clean up resources"
    echo_info "  aws logs tail /aws/lambda/$PROJECT_NAME-$ENVIRONMENT --follow"
}

# Run main function
main "$@"

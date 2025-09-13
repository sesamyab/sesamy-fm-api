#!/bin/bash

# AWS SSO Setup Script for Sesamy FFmpeg Encoding Service
# This script helps you configure AWS SSO authentication

set -e

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

# Check if AWS CLI is installed
check_aws_cli() {
    if ! command -v aws &> /dev/null; then
        echo_error "AWS CLI is not installed. Please install it first:"
        echo_info "  macOS: brew install awscli"
        echo_info "  Linux: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
        exit 1
    fi
    
    # Check AWS CLI version (SSO requires v2)
    AWS_VERSION=$(aws --version 2>&1 | cut -d/ -f2 | cut -d' ' -f1)
    if [[ $(echo "$AWS_VERSION" | cut -d. -f1) -lt 2 ]]; then
        echo_warn "AWS CLI v1 detected. SSO requires AWS CLI v2."
        echo_info "Please upgrade: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
        exit 1
    fi
    
    echo_info "✅ AWS CLI v2 is installed: $AWS_VERSION"
}

# Setup SSO configuration
setup_sso() {
    echo_step "Setting up AWS SSO configuration"
    echo ""
    echo_info "You'll need the following information from your AWS administrator:"
    echo_info "  - SSO start URL (e.g., https://your-org.awsapps.com/start)"
    echo_info "  - SSO region (e.g., us-east-1)"
    echo_info "  - Account ID or name"
    echo_info "  - Role name (e.g., AdministratorAccess, PowerUserAccess)"
    echo ""
    
    read -p "Do you want to configure a new SSO profile? (y/N): " -r
    if [[ ! "$REPLY" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        echo_info "Skipping SSO configuration."
        return
    fi
    
    echo_step "Starting AWS SSO configuration..."
    aws configure sso --profile sesamy-sso
    
    echo_info "✅ SSO profile 'sesamy-sso' configured!"
    echo_info "To use this profile: export AWS_PROFILE=sesamy-sso"
}

# Test SSO login
test_sso_login() {
    echo_step "Testing SSO login"
    
    # Check if we have any SSO profiles
    SSO_PROFILES=$(aws configure list-profiles | grep -i sso || true)
    
    if [ -z "$SSO_PROFILES" ]; then
        echo_warn "No SSO profiles found. Please run setup first."
        return
    fi
    
    echo_info "Available SSO profiles:"
    echo "$SSO_PROFILES"
    echo ""
    
    # Use the first SSO profile or sesamy-sso if it exists
    if echo "$SSO_PROFILES" | grep -q "sesamy-sso"; then
        PROFILE="sesamy-sso"
    else
        PROFILE=$(echo "$SSO_PROFILES" | head -1)
    fi
    
    echo_info "Testing login with profile: $PROFILE"
    
    # Try to login
    if aws sso login --profile $PROFILE; then
        echo_info "✅ SSO login successful!"
        
        # Test credentials
        if aws sts get-caller-identity --profile $PROFILE &> /dev/null; then
            ACCOUNT_ID=$(aws sts get-caller-identity --profile $PROFILE --query Account --output text)
            USER_ARN=$(aws sts get-caller-identity --profile $PROFILE --query Arn --output text)
            echo_info "Account ID: $ACCOUNT_ID"
            echo_info "User ARN: $USER_ARN"
            echo ""
            echo_info "🎉 SSO is working correctly!"
            echo_info "To use this profile for deployment:"
            echo_info "  export AWS_PROFILE=$PROFILE"
            echo_info "  cd cdk && ./deploy.sh"
        else
            echo_warn "Login succeeded but credentials test failed."
        fi
    else
        echo_warn "SSO login failed. Please check your configuration."
    fi
}

# Show current AWS configuration
show_current_config() {
    echo_step "Current AWS Configuration"
    
    if [ -n "$AWS_PROFILE" ]; then
        echo_info "Current AWS_PROFILE: $AWS_PROFILE"
    else
        echo_info "No AWS_PROFILE set (using default)"
    fi
    
    echo_info "Available profiles:"
    aws configure list-profiles | sed 's/^/  /'
    echo ""
    
    echo_info "Current credentials status:"
    if aws sts get-caller-identity &> /dev/null; then
        ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
        USER_ARN=$(aws sts get-caller-identity --query Arn --output text)
        echo_info "  ✅ Valid credentials"
        echo_info "  Account: $ACCOUNT_ID"
        echo_info "  Identity: $USER_ARN"
    else
        echo_warn "  ❌ No valid credentials"
        echo_info "  Run './sso-setup.sh login' to authenticate"
    fi
}

# Show usage instructions
show_usage() {
    echo_info "Sesamy AWS SSO Setup"
    echo_info ""
    echo_info "Usage: $0 [command]"
    echo_info ""
    echo_info "Commands:"
    echo_info "  setup    - Configure new SSO profile"
    echo_info "  login    - Test SSO login"
    echo_info "  status   - Show current configuration"
    echo_info "  help     - Show this help"
    echo_info ""
    echo_info "Environment Variables:"
    echo_info "  AWS_PROFILE - Profile to use (e.g., sesamy-sso)"
    echo_info ""
    echo_info "Example workflow:"
    echo_info "  1. ./sso-setup.sh setup     # Configure SSO"
    echo_info "  2. ./sso-setup.sh login     # Test login"
    echo_info "  3. export AWS_PROFILE=sesamy-sso"
    echo_info "  4. cd cdk && ./deploy.sh    # Deploy"
}

# Main function
main() {
    echo_info "🔐 AWS SSO Setup for Sesamy FFmpeg Encoding Service"
    echo ""
    
    check_aws_cli
    
    case "${1:-help}" in
        "setup")
            setup_sso
            ;;
        "login")
            test_sso_login
            ;;
        "status")
            show_current_config
            ;;
        "help"|*)
            show_usage
            ;;
    esac
}

main "$@"

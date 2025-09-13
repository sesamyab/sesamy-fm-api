import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";

export interface EncodingStackProps extends cdk.StackProps {
  environment: string;
}

export class EncodingStack extends cdk.Stack {
  public readonly ecrRepository: ecr.IRepository;
  public readonly lambdaFunction: lambda.Function;
  public readonly functionUrl: lambda.FunctionUrl;
  public readonly apiGateway: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: EncodingStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // ECR Repository for container images - use existing one
    this.ecrRepository = ecr.Repository.fromRepositoryName(
      this,
      "EncodingRepository",
      `sesamy-encoding-${environment}`
    );

    // IAM Role for Lambda
    const lambdaRole = new iam.Role(this, "EncodingLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaVPCAccessExecutionRole"
        ),
      ],
    });

    // CloudWatch Log Group
    const logGroup = new logs.LogGroup(this, "EncodingLogGroup", {
      logGroupName: `/aws/lambda/sesamy-encoding-${environment}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda Function with Container Image
    this.lambdaFunction = new lambda.Function(this, "EncodingFunction", {
      functionName: `sesamy-encoding-${environment}`,
      code: lambda.Code.fromEcrImage(this.ecrRepository, {
        tagOrDigest: "latest",
      }),
      handler: lambda.Handler.FROM_IMAGE,
      runtime: lambda.Runtime.FROM_IMAGE,
      role: lambdaRole,

      // Maximum configuration for biggest Lambda
      memorySize: 10240, // 10 GB
      timeout: cdk.Duration.minutes(15), // 15 minutes
      ephemeralStorageSize: cdk.Size.gibibytes(10), // 10 GB

      // Environment variables
      environment: {
        NODE_ENV: environment,
      },

      // Architecture - use x86_64 for FFmpeg compatibility
      architecture: lambda.Architecture.X86_64,
    });

    // Lambda Function URL for direct HTTP access
    this.functionUrl = this.lambdaFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ["*"],
        maxAge: cdk.Duration.hours(24),
      },
    });

    // API Gateway for additional features (custom domain, throttling, etc.)
    this.apiGateway = new apigateway.RestApi(this, "EncodingApi", {
      restApiName: `sesamy-encoding-api-${environment}`,
      description: `FFmpeg Encoding Service API - ${environment}`,

      // CORS configuration
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization"],
      },

      // Deploy automatically
      deploy: true,
      deployOptions: {
        stageName: environment,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
    });

    // Lambda integration for API Gateway
    const lambdaIntegration = new apigateway.LambdaIntegration(
      this.lambdaFunction,
      {
        requestTemplates: { "application/json": '{ "statusCode": "200" }' },
      }
    );

    // Add proxy resource to handle all paths
    const proxyResource = this.apiGateway.root.addResource("{proxy+}");
    proxyResource.addMethod("ANY", lambdaIntegration);

    // Add root method
    this.apiGateway.root.addMethod("ANY", lambdaIntegration);

    // Grant API Gateway permission to invoke Lambda
    this.lambdaFunction.addPermission("ApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      sourceArn: this.apiGateway.arnForExecuteApi(),
    });

    // CloudWatch Dashboard (optional)
    const dashboard = new cdk.aws_cloudwatch.Dashboard(
      this,
      "EncodingDashboard",
      {
        dashboardName: `sesamy-encoding-${environment}-${
          cdk.Stack.of(this).region
        }`,
      }
    );

    // Add Lambda metrics to dashboard
    dashboard.addWidgets(
      new cdk.aws_cloudwatch.GraphWidget({
        title: "Lambda Invocations",
        left: [this.lambdaFunction.metricInvocations()],
      }),
      new cdk.aws_cloudwatch.GraphWidget({
        title: "Lambda Duration",
        left: [this.lambdaFunction.metricDuration()],
      }),
      new cdk.aws_cloudwatch.GraphWidget({
        title: "Lambda Errors",
        left: [this.lambdaFunction.metricErrors()],
      })
    );

    // Outputs
    new cdk.CfnOutput(this, "ECRRepositoryUri", {
      value: this.ecrRepository.repositoryUri,
      description: "ECR Repository URI",
      exportName: `sesamy-encoding-ecr-${environment}`,
    });

    new cdk.CfnOutput(this, "LambdaFunctionName", {
      value: this.lambdaFunction.functionName,
      description: "Lambda Function Name",
      exportName: `sesamy-encoding-function-${environment}`,
    });

    new cdk.CfnOutput(this, "LambdaFunctionUrl", {
      value: this.functionUrl.url,
      description: "Lambda Function URL",
      exportName: `sesamy-encoding-url-${environment}`,
    });

    new cdk.CfnOutput(this, "ApiGatewayUrl", {
      value: this.apiGateway.url,
      description: "API Gateway URL",
      exportName: `sesamy-encoding-api-${environment}`,
    });

    new cdk.CfnOutput(this, "DashboardUrl", {
      value: `https://${
        cdk.Stack.of(this).region
      }.console.aws.amazon.com/cloudwatch/home?region=${
        cdk.Stack.of(this).region
      }#dashboards:name=${dashboard.dashboardName}`,
      description: "CloudWatch Dashboard URL",
    });
  }
}

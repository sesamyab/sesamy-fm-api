"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EncodingStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const ecr = require("aws-cdk-lib/aws-ecr");
const iam = require("aws-cdk-lib/aws-iam");
const logs = require("aws-cdk-lib/aws-logs");
const apigateway = require("aws-cdk-lib/aws-apigateway");
class EncodingStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { environment } = props;
        // ECR Repository for container images - use existing one
        this.ecrRepository = ecr.Repository.fromRepositoryName(this, "EncodingRepository", `sesamy-encoding-${environment}`);
        // IAM Role for Lambda
        const lambdaRole = new iam.Role(this, "EncodingLambdaRole", {
            assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"),
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
            memorySize: 10240,
            timeout: cdk.Duration.minutes(15),
            ephemeralStorageSize: cdk.Size.gibibytes(10),
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
        const lambdaIntegration = new apigateway.LambdaIntegration(this.lambdaFunction, {
            requestTemplates: { "application/json": '{ "statusCode": "200" }' },
        });
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
        const dashboard = new cdk.aws_cloudwatch.Dashboard(this, "EncodingDashboard", {
            dashboardName: `sesamy-encoding-${environment}-${cdk.Stack.of(this).region}`,
        });
        // Add Lambda metrics to dashboard
        dashboard.addWidgets(new cdk.aws_cloudwatch.GraphWidget({
            title: "Lambda Invocations",
            left: [this.lambdaFunction.metricInvocations()],
        }), new cdk.aws_cloudwatch.GraphWidget({
            title: "Lambda Duration",
            left: [this.lambdaFunction.metricDuration()],
        }), new cdk.aws_cloudwatch.GraphWidget({
            title: "Lambda Errors",
            left: [this.lambdaFunction.metricErrors()],
        }));
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
            value: `https://${cdk.Stack.of(this).region}.console.aws.amazon.com/cloudwatch/home?region=${cdk.Stack.of(this).region}#dashboards:name=${dashboard.dashboardName}`,
            description: "CloudWatch Dashboard URL",
        });
    }
}
exports.EncodingStack = EncodingStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW5jb2Rpbmctc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJlbmNvZGluZy1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMsaURBQWlEO0FBQ2pELDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsNkNBQTZDO0FBQzdDLHlEQUF5RDtBQU96RCxNQUFhLGFBQWMsU0FBUSxHQUFHLENBQUMsS0FBSztJQU0xQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXlCO1FBQ2pFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFBRSxXQUFXLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFOUIseURBQXlEO1FBQ3pELElBQUksQ0FBQyxhQUFhLEdBQUcsR0FBRyxDQUFDLFVBQVUsQ0FBQyxrQkFBa0IsQ0FDcEQsSUFBSSxFQUNKLG9CQUFvQixFQUNwQixtQkFBbUIsV0FBVyxFQUFFLENBQ2pDLENBQUM7UUFFRixzQkFBc0I7UUFDdEIsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUMxRCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUM7WUFDM0QsZUFBZSxFQUFFO2dCQUNmLEdBQUcsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQ3hDLDBDQUEwQyxDQUMzQztnQkFDRCxHQUFHLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUN4Qyw4Q0FBOEMsQ0FDL0M7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUVILHVCQUF1QjtRQUN2QixNQUFNLFFBQVEsR0FBRyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzNELFlBQVksRUFBRSwrQkFBK0IsV0FBVyxFQUFFO1lBQzFELFNBQVMsRUFBRSxJQUFJLENBQUMsYUFBYSxD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IGFzIGNkayBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYVwiO1xuaW1wb3J0ICogYXMgZWNyIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZWNyXCI7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sb2dzXCI7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheVwiO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBFbmNvZGluZ1N0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGVudmlyb25tZW50OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBFbmNvZGluZ1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGVjclJlcG9zaXRvcnk6IGVjci5JUmVwb3NpdG9yeTtcbiAgcHVibGljIHJlYWRvbmx5IGxhbWJkYUZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XG4gIHB1YmxpYyByZWFkb25seSBmdW5jdGlvblVybDogbGFtYmRhLkZ1bmN0aW9uVXJsO1xuICBwdWJsaWMgcmVhZG9ubHkgYXBpR2F0ZXdheTogYXBpZ2F0ZXdheS5SZXN0QXBpO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBFbmNvZGluZ1N0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52aXJvbm1lbnQgfSA9IHByb3BzO1xuXG4gICAgLy8gRUNSIFJlcG9zaXRvcnkgZm9yIGNvbnRhaW5lciBpbWFnZXMgLSB1c2UgZXhpc3Rpbmcgb25lXG4gICAgdGhpcy5lY3JSZXBvc2l0b3J5ID0gZWNyLlJlcG9zaXRvcnkuZnJvbVJlcG9zaXRvcnlOYW1lKFxuICAgICAgdGhpcyxcbiAgICAgIFwiRW5jb2RpbmdSZXBvc2l0b3J5XCIsXG4gICAgICBgc2VzYW15LWVuY29kaW5nLSR7ZW52aXJvbm1lbnR9YFxuICAgICk7XG5cbiAgICAvLyBJQU0gUm9sZSBmb3IgTGFtYmRhXG4gICAgY29uc3QgbGFtYmRhUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCBcIkVuY29kaW5nTGFtYmRhUm9sZVwiLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbChcImxhbWJkYS5hbWF6b25hd3MuY29tXCIpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcbiAgICAgICAgICBcInNlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGVcIlxuICAgICAgICApLFxuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhVlBDQWNjZXNzRXhlY3V0aW9uUm9sZVwiXG4gICAgICAgICksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQ2xvdWRXYXRjaCBMb2cgR3JvdXBcbiAgICBjb25zdCBsb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsIFwiRW5jb2RpbmdMb2dHcm91cFwiLCB7XG4gICAgICBsb2dHcm91cE5hbWU6IGAvYXdzL2xhbWJkYS9zZXNhbXktZW5jb2RpbmctJHtlbnZpcm9ubWVudH1gLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuVFdPX1dFRUtTLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vIExhbWJkYSBGdW5jdGlvbiB3aXRoIENvbnRhaW5lciBJbWFnZVxuICAgIHRoaXMubGFtYmRhRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIFwiRW5jb2RpbmdGdW5jdGlvblwiLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6IGBzZXNhbXktZW5jb2RpbmctJHtlbnZpcm9ubWVudH1gLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUVjckltYWdlKHRoaXMuZWNyUmVwb3NpdG9yeSwge1xuICAgICAgICB0YWdPckRpZ2VzdDogXCJsYXRlc3RcIixcbiAgICAgIH0pLFxuICAgICAgaGFuZGxlcjogbGFtYmRhLkhhbmRsZXIuRlJPTV9JTUFHRSxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLkZST01fSU1BR0UsXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxuXG4gICAgICAvLyBNYXhpbXVtIGNvbmZpZ3VyYXRpb24gZm9yIGJpZ2dlc3QgTGFtYmRhXG4gICAgICBtZW1vcnlTaXplOiAxMDI0MCwgLy8gMTAgR0JcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSwgLy8gMTUgbWludXRlc1xuICAgICAgZXBoZW1lcmFsU3RvcmFnZVNpemU6IGNkay5TaXplLmdpYmlieXRlcygxMCksIC8vIDEwIEdCXG5cbiAgICAgIC8vIEVudmlyb25tZW50IHZhcmlhYmxlc1xuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgTk9ERV9FTlY6IGVudmlyb25tZW50LFxuICAgICAgfSxcblxuICAgICAgLy8gQXJjaGl0ZWN0dXJlIC0gdXNlIHg4Nl82NCBmb3IgRkZtcGVnIGNvbXBhdGliaWxpdHlcbiAgICAgIGFyY2hpdGVjdHVyZTogbGFtYmRhLkFyY2hpdGVjdHVyZS5YODZfNjQsXG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGEgRnVuY3Rpb24gVVJMIGZvciBkaXJlY3QgSFRUUCBhY2Nlc3NcbiAgICB0aGlzLmZ1bmN0aW9uVXJsID0gdGhpcy5sYW1iZGFGdW5jdGlvbi5hZGRGdW5jdGlvblVybCh7XG4gICAgICBhdXRoVHlwZTogbGFtYmRhLkZ1bmN0aW9uVXJsQXV0aFR5cGUuTk9ORSxcbiAgICAgIGNvcnM6IHtcbiAgICAgICAgYWxsb3dlZE9yaWdpbnM6IFtcIipcIl0sXG4gICAgICAgIGFsbG93ZWRNZXRob2RzOiBbbGFtYmRhLkh0dHBNZXRob2QuQUxMXSxcbiAgICAgICAgYWxsb3dlZEhlYWRlcnM6IFtcIipcIl0sXG4gICAgICAgIG1heEFnZTogY2RrLkR1cmF0aW9uLmhvdXJzKDI0KSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBBUEkgR2F0ZXdheSBmb3IgYWRkaXRpb25hbCBmZWF0dXJlcyAoY3VzdG9tIGRvbWFpbiwgdGhyb3R0bGluZywgZXRjLilcbiAgICB0aGlzLmFwaUdhdGV3YXkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsIFwiRW5jb2RpbmdBcGlcIiwge1xuICAgICAgcmVzdEFwaU5hbWU6IGBzZXNhbXktZW5jb2RpbmctYXBpLSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiBgRkZtcGVnIEVuY29kaW5nIFNlcnZpY2UgQVBJIC0gJHtlbnZpcm9ubWVudH1gLFxuXG4gICAgICAvLyBDT1JTIGNvbmZpZ3VyYXRpb25cbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczoge1xuICAgICAgICBhbGxvd09yaWdpbnM6IGFwaWdhdGV3YXkuQ29ycy5BTExfT1JJR0lOUyxcbiAgICAgICAgYWxsb3dNZXRob2RzOiBhcGlnYXRld2F5LkNvcnMuQUxMX01FVEhPRFMsXG4gICAgICAgIGFsbG93SGVhZGVyczogW1wiQ29udGVudC1UeXBlXCIsIFwiQXV0aG9yaXphdGlvblwiXSxcbiAgICAgIH0sXG5cbiAgICAgIC8vIERlcGxveSBhdXRvbWF0aWNhbGx5XG4gICAgICBkZXBsb3k6IHRydWUsXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIHN0YWdlTmFtZTogZW52aXJvbm1lbnQsXG4gICAgICAgIGxvZ2dpbmdMZXZlbDogYXBpZ2F0ZXdheS5NZXRob2RMb2dnaW5nTGV2ZWwuSU5GTyxcbiAgICAgICAgZGF0YVRyYWNlRW5hYmxlZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGEgaW50ZWdyYXRpb24gZm9yIEFQSSBHYXRld2F5XG4gICAgY29uc3QgbGFtYmRhSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihcbiAgICAgIHRoaXMubGFtYmRhRnVuY3Rpb24sXG4gICAgICB7XG4gICAgICAgIHJlcXVlc3RUZW1wbGF0ZXM6IHsgXCJhcHBsaWNhdGlvbi9qc29uXCI6ICd7IFwic3RhdHVzQ29kZVwiOiBcIjIwMFwiIH0nIH0sXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIEFkZCBwcm94eSByZXNvdXJjZSB0byBoYW5kbGUgYWxsIHBhdGhzXG4gICAgY29uc3QgcHJveHlSZXNvdXJjZSA9IHRoaXMuYXBpR2F0ZXdheS5yb290LmFkZFJlc291cmNlKFwie3Byb3h5K31cIik7XG4gICAgcHJveHlSZXNvdXJjZS5hZGRNZXRob2QoXCJBTllcIiwgbGFtYmRhSW50ZWdyYXRpb24pO1xuXG4gICAgLy8gQWRkIHJvb3QgbWV0aG9kXG4gICAgdGhpcy5hcGlHYXRld2F5LnJvb3QuYWRkTWV0aG9kKFwiQU5ZXCIsIGxhbWJkYUludGVncmF0aW9uKTtcblxuICAgIC8vIEdyYW50IEFQSSBHYXRld2F5IHBlcm1pc3Npb24gdG8gaW52b2tlIExhbWJkYVxuICAgIHRoaXMubGFtYmRhRnVuY3Rpb24uYWRkUGVybWlzc2lvbihcIkFwaUdhdGV3YXlJbnZva2VcIiwge1xuICAgICAgcHJpbmNpcGFsOiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJhcGlnYXRld2F5LmFtYXpvbmF3cy5jb21cIiksXG4gICAgICBzb3VyY2VBcm46IHRoaXMuYXBpR2F0ZXdheS5hcm5Gb3JFeGVjdXRlQXBpKCksXG4gICAgfSk7XG5cbiAgICAvLyBDbG91ZFdhdGNoIERhc2hib2FyZCAob3B0aW9uYWwpXG4gICAgY29uc3QgZGFzaGJvYXJkID0gbmV3IGNkay5hd3NfY2xvdWR3YXRjaC5EYXNoYm9hcmQoXG4gICAgICB0aGlzLFxuICAgICAgXCJFbmNvZGluZ0Rhc2hib2FyZFwiLFxuICAgICAge1xuICAgICAgICBkYXNoYm9hcmROYW1lOiBgc2VzYW15LWVuY29kaW5nLSR7ZW52aXJvbm1lbnR9LSR7XG4gICAgICAgICAgY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvblxuICAgICAgICB9YCxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gQWRkIExhbWJkYSBtZXRyaWNzIHRvIGRhc2hib2FyZFxuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNkay5hd3NfY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIkxhbWJkYSBJbnZvY2F0aW9uc1wiLFxuICAgICAgICBsZWZ0OiBbdGhpcy5sYW1iZGFGdW5jdGlvbi5tZXRyaWNJbnZvY2F0aW9ucygpXSxcbiAgICAgIH0pLFxuICAgICAgbmV3IGNkay5hd3NfY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIkxhbWJkYSBEdXJhdGlvblwiLFxuICAgICAgICBsZWZ0OiBbdGhpcy5sYW1iZGFGdW5jdGlvbi5tZXRyaWNEdXJhdGlvbigpXSxcbiAgICAgIH0pLFxuICAgICAgbmV3IGNkay5hd3NfY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIkxhbWJkYSBFcnJvcnNcIixcbiAgICAgICAgbGVmdDogW3RoaXMubGFtYmRhRnVuY3Rpb24ubWV0cmljRXJyb3JzKCldLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiRUNSUmVwb3NpdG9yeVVyaVwiLCB7XG4gICAgICB2YWx1ZTogdGhpcy5lY3JSZXBvc2l0b3J5LnJlcG9zaXRvcnlVcmksXG4gICAgICBkZXNjcmlwdGlvbjogXCJFQ1IgUmVwb3NpdG9yeSBVUklcIixcbiAgICAgIGV4cG9ydE5hbWU6IGBzZXNhbXktZW5jb2RpbmctZWNyLSR7ZW52aXJvbm1lbnR9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTGFtYmRhRnVuY3Rpb25OYW1lXCIsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmxhbWJkYUZ1bmN0aW9uLmZ1bmN0aW9uTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkxhbWJkYSBGdW5jdGlvbiBOYW1lXCIsXG4gICAgICBleHBvcnROYW1lOiBgc2VzYW15LWVuY29kaW5nLWZ1bmN0aW9uLSR7ZW52aXJvbm1lbnR9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTGFtYmRhRnVuY3Rpb25VcmxcIiwge1xuICAgICAgdmFsdWU6IHRoaXMuZnVuY3Rpb25VcmwudXJsLFxuICAgICAgZGVzY3JpcHRpb246IFwiTGFtYmRhIEZ1bmN0aW9uIFVSTFwiLFxuICAgICAgZXhwb3J0TmFtZTogYHNlc2FteS1lbmNvZGluZy11cmwtJHtlbnZpcm9ubWVudH1gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJBcGlHYXRld2F5VXJsXCIsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmFwaUdhdGV3YXkudXJsLFxuICAgICAgZGVzY3JpcHRpb246IFwiQVBJIEdhdGV3YXkgVVJMXCIsXG4gICAgICBleHBvcnROYW1lOiBgc2VzYW15LWVuY29kaW5nLWFwaS0ke2Vudmlyb25tZW50fWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkRhc2hib2FyZFVybFwiLCB7XG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHtcbiAgICAgICAgY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvblxuICAgICAgfS5jb25zb2xlLmF3cy5hbWF6b24uY29tL2Nsb3Vkd2F0Y2gvaG9tZT9yZWdpb249JHtcbiAgICAgICAgY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvblxuICAgICAgfSNkYXNoYm9hcmRzOm5hbWU9JHtkYXNoYm9hcmQuZGFzaGJvYXJkTmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246IFwiQ2xvdWRXYXRjaCBEYXNoYm9hcmQgVVJMXCIsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==
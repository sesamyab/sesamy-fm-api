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
        this.ecrRepository = ecr.Repository.fromRepositoryName(this, 'EncodingRepository', `sesamy-encoding-${environment}`);
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
            dashboardName: `sesamy-encoding-${environment}`,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW5jb2Rpbmctc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJlbmNvZGluZy1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMsaURBQWlEO0FBQ2pELDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsNkNBQTZDO0FBQzdDLHlEQUF5RDtBQU96RCxNQUFhLGFBQWMsU0FBUSxHQUFHLENBQUMsS0FBSztJQU0xQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXlCO1FBQ2pFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFBRSxXQUFXLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFOUIseURBQXlEO1FBQ3pELElBQUksQ0FBQyxhQUFhLEdBQUcsR0FBRyxDQUFDLFVBQVUsQ0FBQyxrQkFBa0IsQ0FDcEQsSUFBSSxFQUNKLG9CQUFvQixFQUNwQixtQkFBbUIsV0FBVyxFQUFFLENBQ2pDLENBQUM7UUFFRixzQkFBc0I7UUFDdEIsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUMxRCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUM7WUFDM0QsZUFBZSxFQUFFO2dCQUNmLEdBQUcsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQ3hDLDBDQUEwQyxDQUMzQztnQkFDRCxHQUFHLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUN4Qyw4Q0FBOEMsQ0FDL0M7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUVILHVCQUF1QjtRQUN2QixNQUFNLFFBQVEsR0FBRyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzNELFlBQVksRUFBRSwrQkFBK0IsV0FBVyxFQUFFO1lBQzFELFNBQVMsRUFBRSxJQUFJLENBQUMsYUFBYSxD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O1lBQ2pDLFVBQVUsRUFBRSx1QkFBdUIsV0FBVyxFQUFFO1NBQ2pELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDNUMsS0FBSyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsWUFBWTtZQUN2QyxXQUFXLEVBQUUsc0JBQXNCO1lBQ25DLFVBQVUsRUFBRSw0QkFBNEIsV0FBVyxFQUFFO1NBQ3RELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7WUFDM0MsS0FBSyxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRztZQUMzQixXQUFXLEVBQUUscUJBQXFCO1lBQ2xDLFVBQVUsRUFBRSx1QkFBdUIsV0FBVyxFQUFFO1NBQ2pELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ3ZDLEtBQUssRUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLEdBQUc7WUFDMUIsV0FBVyxFQUFFLGlCQUFpQjtZQUM5QixVQUFVLEVBQUUsdUJBQXVCLFdBQVcsRUFBRTtTQUNqRCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUN0QyxLQUFLLEVBQUUsV0FBVyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLGtEQUFrRCxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLG9CQUFvQixTQUFTLENBQUMsYUFBYSxFQUFFO1lBQ25LLFdBQVcsRUFBRSwwQkFBMEI7U0FDeEMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBMUtELHNDQTBLQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYVwiO1xuaW1wb3J0ICogYXMgZWNyIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZWNyXCI7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sb2dzXCI7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheVwiO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBFbmNvZGluZ1N0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGVudmlyb25tZW50OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBFbmNvZGluZ1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGVjclJlcG9zaXRvcnk6IGVjci5JUmVwb3NpdG9yeTtcbiAgcHVibGljIHJlYWRvbmx5IGxhbWJkYUZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XG4gIHB1YmxpYyByZWFkb25seSBmdW5jdGlvblVybDogbGFtYmRhLkZ1bmN0aW9uVXJsO1xuICBwdWJsaWMgcmVhZG9ubHkgYXBpR2F0ZXdheTogYXBpZ2F0ZXdheS5SZXN0QXBpO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBFbmNvZGluZ1N0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52aXJvbm1lbnQgfSA9IHByb3BzO1xuXG4gICAgLy8gRUNSIFJlcG9zaXRvcnkgZm9yIGNvbnRhaW5lciBpbWFnZXMgLSB1c2UgZXhpc3Rpbmcgb25lXG4gICAgdGhpcy5lY3JSZXBvc2l0b3J5ID0gZWNyLlJlcG9zaXRvcnkuZnJvbVJlcG9zaXRvcnlOYW1lKFxuICAgICAgdGhpcyxcbiAgICAgICdFbmNvZGluZ1JlcG9zaXRvcnknLFxuICAgICAgYHNlc2FteS1lbmNvZGluZy0ke2Vudmlyb25tZW50fWBcbiAgICApO1xuXG4gICAgLy8gSUFNIFJvbGUgZm9yIExhbWJkYVxuICAgIGNvbnN0IGxhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgXCJFbmNvZGluZ0xhbWJkYVJvbGVcIiwge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJsYW1iZGEuYW1hem9uYXdzLmNvbVwiKSxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlXCJcbiAgICAgICAgKSxcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxuICAgICAgICAgIFwic2VydmljZS1yb2xlL0FXU0xhbWJkYVZQQ0FjY2Vzc0V4ZWN1dGlvblJvbGVcIlxuICAgICAgICApLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIENsb3VkV2F0Y2ggTG9nIEdyb3VwXG4gICAgY29uc3QgbG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCBcIkVuY29kaW5nTG9nR3JvdXBcIiwge1xuICAgICAgbG9nR3JvdXBOYW1lOiBgL2F3cy9sYW1iZGEvc2VzYW15LWVuY29kaW5nLSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLlRXT19XRUVLUyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGEgRnVuY3Rpb24gd2l0aCBDb250YWluZXIgSW1hZ2VcbiAgICB0aGlzLmxhbWJkYUZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBcIkVuY29kaW5nRnVuY3Rpb25cIiwge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgc2VzYW15LWVuY29kaW5nLSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21FY3JJbWFnZSh0aGlzLmVjclJlcG9zaXRvcnksIHtcbiAgICAgICAgdGFnT3JEaWdlc3Q6IFwibGF0ZXN0XCIsXG4gICAgICB9KSxcbiAgICAgIGhhbmRsZXI6IGxhbWJkYS5IYW5kbGVyLkZST01fSU1BR0UsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5GUk9NX0lNQUdFLFxuICAgICAgcm9sZTogbGFtYmRhUm9sZSxcblxuICAgICAgLy8gTWF4aW11bSBjb25maWd1cmF0aW9uIGZvciBiaWdnZXN0IExhbWJkYVxuICAgICAgbWVtb3J5U2l6ZTogMTAyNDAsIC8vIDEwIEdCXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksIC8vIDE1IG1pbnV0ZXNcbiAgICAgIGVwaGVtZXJhbFN0b3JhZ2VTaXplOiBjZGsuU2l6ZS5naWJpYnl0ZXMoMTApLCAvLyAxMCBHQlxuXG4gICAgICAvLyBFbnZpcm9ubWVudCB2YXJpYWJsZXNcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIE5PREVfRU5WOiBlbnZpcm9ubWVudCxcbiAgICAgIH0sXG5cbiAgICAgIC8vIEFyY2hpdGVjdHVyZSAtIHVzZSB4ODZfNjQgZm9yIEZGbXBlZyBjb21wYXRpYmlsaXR5XG4gICAgICBhcmNoaXRlY3R1cmU6IGxhbWJkYS5BcmNoaXRlY3R1cmUuWDg2XzY0LFxuICAgIH0pO1xuXG4gICAgLy8gTGFtYmRhIEZ1bmN0aW9uIFVSTCBmb3IgZGlyZWN0IEhUVFAgYWNjZXNzXG4gICAgdGhpcy5mdW5jdGlvblVybCA9IHRoaXMubGFtYmRhRnVuY3Rpb24uYWRkRnVuY3Rpb25Vcmwoe1xuICAgICAgYXV0aFR5cGU6IGxhbWJkYS5GdW5jdGlvblVybEF1dGhUeXBlLk5PTkUsXG4gICAgICBjb3JzOiB7XG4gICAgICAgIGFsbG93ZWRPcmlnaW5zOiBbXCIqXCJdLFxuICAgICAgICBhbGxvd2VkTWV0aG9kczogW2xhbWJkYS5IdHRwTWV0aG9kLkFMTF0sXG4gICAgICAgIGFsbG93ZWRIZWFkZXJzOiBbXCIqXCJdLFxuICAgICAgICBtYXhBZ2U6IGNkay5EdXJhdGlvbi5ob3VycygyNCksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQVBJIEdhdGV3YXkgZm9yIGFkZGl0aW9uYWwgZmVhdHVyZXMgKGN1c3RvbSBkb21haW4sIHRocm90dGxpbmcsIGV0Yy4pXG4gICAgdGhpcy5hcGlHYXRld2F5ID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCBcIkVuY29kaW5nQXBpXCIsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiBgc2VzYW15LWVuY29kaW5nLWFwaS0ke2Vudmlyb25tZW50fWAsXG4gICAgICBkZXNjcmlwdGlvbjogYEZGbXBlZyBFbmNvZGluZyBTZXJ2aWNlIEFQSSAtICR7ZW52aXJvbm1lbnR9YCxcblxuICAgICAgLy8gQ09SUyBjb25maWd1cmF0aW9uXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHtcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsXG4gICAgICAgIGFsbG93TWV0aG9kczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9NRVRIT0RTLFxuICAgICAgICBhbGxvd0hlYWRlcnM6IFtcIkNvbnRlbnQtVHlwZVwiLCBcIkF1dGhvcml6YXRpb25cIl0sXG4gICAgICB9LFxuXG4gICAgICAvLyBEZXBsb3kgYXV0b21hdGljYWxseVxuICAgICAgZGVwbG95OiB0cnVlLFxuICAgICAgZGVwbG95T3B0aW9uczoge1xuICAgICAgICBzdGFnZU5hbWU6IGVudmlyb25tZW50LFxuICAgICAgICBsb2dnaW5nTGV2ZWw6IGFwaWdhdGV3YXkuTWV0aG9kTG9nZ2luZ0xldmVsLklORk8sXG4gICAgICAgIGRhdGFUcmFjZUVuYWJsZWQ6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gTGFtYmRhIGludGVncmF0aW9uIGZvciBBUEkgR2F0ZXdheVxuICAgIGNvbnN0IGxhbWJkYUludGVncmF0aW9uID0gbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oXG4gICAgICB0aGlzLmxhbWJkYUZ1bmN0aW9uLFxuICAgICAge1xuICAgICAgICByZXF1ZXN0VGVtcGxhdGVzOiB7IFwiYXBwbGljYXRpb24vanNvblwiOiAneyBcInN0YXR1c0NvZGVcIjogXCIyMDBcIiB9JyB9LFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBBZGQgcHJveHkgcmVzb3VyY2UgdG8gaGFuZGxlIGFsbCBwYXRoc1xuICAgIGNvbnN0IHByb3h5UmVzb3VyY2UgPSB0aGlzLmFwaUdhdGV3YXkucm9vdC5hZGRSZXNvdXJjZShcIntwcm94eSt9XCIpO1xuICAgIHByb3h5UmVzb3VyY2UuYWRkTWV0aG9kKFwiQU5ZXCIsIGxhbWJkYUludGVncmF0aW9uKTtcblxuICAgIC8vIEFkZCByb290IG1ldGhvZFxuICAgIHRoaXMuYXBpR2F0ZXdheS5yb290LmFkZE1ldGhvZChcIkFOWVwiLCBsYW1iZGFJbnRlZ3JhdGlvbik7XG5cbiAgICAvLyBHcmFudCBBUEkgR2F0ZXdheSBwZXJtaXNzaW9uIHRvIGludm9rZSBMYW1iZGFcbiAgICB0aGlzLmxhbWJkYUZ1bmN0aW9uLmFkZFBlcm1pc3Npb24oXCJBcGlHYXRld2F5SW52b2tlXCIsIHtcbiAgICAgIHByaW5jaXBhbDogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKFwiYXBpZ2F0ZXdheS5hbWF6b25hd3MuY29tXCIpLFxuICAgICAgc291cmNlQXJuOiB0aGlzLmFwaUdhdGV3YXkuYXJuRm9yRXhlY3V0ZUFwaSgpLFxuICAgIH0pO1xuXG4gICAgLy8gQ2xvdWRXYXRjaCBEYXNoYm9hcmQgKG9wdGlvbmFsKVxuICAgIGNvbnN0IGRhc2hib2FyZCA9IG5ldyBjZGsuYXdzX2Nsb3Vkd2F0Y2guRGFzaGJvYXJkKFxuICAgICAgdGhpcyxcbiAgICAgIFwiRW5jb2RpbmdEYXNoYm9hcmRcIixcbiAgICAgIHtcbiAgICAgICAgZGFzaGJvYXJkTmFtZTogYHNlc2FteS1lbmNvZGluZy0ke2Vudmlyb25tZW50fWAsXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIEFkZCBMYW1iZGEgbWV0cmljcyB0byBkYXNoYm9hcmRcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjZGsuYXdzX2Nsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogXCJMYW1iZGEgSW52b2NhdGlvbnNcIixcbiAgICAgICAgbGVmdDogW3RoaXMubGFtYmRhRnVuY3Rpb24ubWV0cmljSW52b2NhdGlvbnMoKV0sXG4gICAgICB9KSxcbiAgICAgIG5ldyBjZGsuYXdzX2Nsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogXCJMYW1iZGEgRHVyYXRpb25cIixcbiAgICAgICAgbGVmdDogW3RoaXMubGFtYmRhRnVuY3Rpb24ubWV0cmljRHVyYXRpb24oKV0sXG4gICAgICB9KSxcbiAgICAgIG5ldyBjZGsuYXdzX2Nsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogXCJMYW1iZGEgRXJyb3JzXCIsXG4gICAgICAgIGxlZnQ6IFt0aGlzLmxhbWJkYUZ1bmN0aW9uLm1ldHJpY0Vycm9ycygpXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIE91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkVDUlJlcG9zaXRvcnlVcmlcIiwge1xuICAgICAgdmFsdWU6IHRoaXMuZWNyUmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpLFxuICAgICAgZGVzY3JpcHRpb246IFwiRUNSIFJlcG9zaXRvcnkgVVJJXCIsXG4gICAgICBleHBvcnROYW1lOiBgc2VzYW15LWVuY29kaW5nLWVjci0ke2Vudmlyb25tZW50fWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkxhbWJkYUZ1bmN0aW9uTmFtZVwiLCB7XG4gICAgICB2YWx1ZTogdGhpcy5sYW1iZGFGdW5jdGlvbi5mdW5jdGlvbk5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogXCJMYW1iZGEgRnVuY3Rpb24gTmFtZVwiLFxuICAgICAgZXhwb3J0TmFtZTogYHNlc2FteS1lbmNvZGluZy1mdW5jdGlvbi0ke2Vudmlyb25tZW50fWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkxhbWJkYUZ1bmN0aW9uVXJsXCIsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmZ1bmN0aW9uVXJsLnVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkxhbWJkYSBGdW5jdGlvbiBVUkxcIixcbiAgICAgIGV4cG9ydE5hbWU6IGBzZXNhbXktZW5jb2RpbmctdXJsLSR7ZW52aXJvbm1lbnR9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiQXBpR2F0ZXdheVVybFwiLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hcGlHYXRld2F5LnVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkFQSSBHYXRld2F5IFVSTFwiLFxuICAgICAgZXhwb3J0TmFtZTogYHNlc2FteS1lbmNvZGluZy1hcGktJHtlbnZpcm9ubWVudH1gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJEYXNoYm9hcmRVcmxcIiwge1xuICAgICAgdmFsdWU6IGBodHRwczovLyR7Y2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbn0uY29uc29sZS5hd3MuYW1hem9uLmNvbS9jbG91ZHdhdGNoL2hvbWU/cmVnaW9uPSR7Y2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbn0jZGFzaGJvYXJkczpuYW1lPSR7ZGFzaGJvYXJkLmRhc2hib2FyZE5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkNsb3VkV2F0Y2ggRGFzaGJvYXJkIFVSTFwiLFxuICAgIH0pO1xuICB9XG59XG4iXX0=
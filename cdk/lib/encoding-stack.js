"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EncodingStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const ecr = require("aws-cdk-lib/aws-ecr");
const iam = require("aws-cdk-lib/aws-iam");
const logs = require("aws-cdk-lib/aws-logs");
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
        new cdk.CfnOutput(this, "DashboardUrl", {
            value: `https://${cdk.Stack.of(this).region}.console.aws.amazon.com/cloudwatch/home?region=${cdk.Stack.of(this).region}#dashboards:name=${dashboard.dashboardName}`,
            description: "CloudWatch Dashboard URL",
        });
    }
}
exports.EncodingStack = EncodingStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW5jb2Rpbmctc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJlbmNvZGluZy1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMsaURBQWlEO0FBQ2pELDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsNkNBQTZDO0FBTzdDLE1BQWEsYUFBYyxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBSzFDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBeUI7UUFDakUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLFdBQVcsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUU5Qix5REFBeUQ7UUFDekQsSUFBSSxDQUFDLGFBQWEsR0FBRyxHQUFHLENBQUMsVUFBVSxDQUFDLGtCQUFrQixDQUNwRCxJQUFJLEVBQ0osb0JBQW9CLEVBQ3BCLG1CQUFtQixXQUFXLEVBQUUsQ0FDakMsQ0FBQztRQUVGLHNCQUFzQjtRQUN0QixNQUFNLFVBQVUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQzFELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQztZQUMzRCxlQUFlLEVBQUU7Z0JBQ2YsR0FBRyxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsQ0FDeEMsMENBQTBDLENBQzNDO2dCQUNELEdBQUcsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQ3hDLDhDQUE4QyxDQUMvQzthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsdUJBQXVCO1FBQ3ZCLE1BQU0sUUFBUSxHQUFHLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDM0QsWUFBWSxFQUFFLCtCQUErQixXQUFXLEVBQUU7WUFDMUQsU0FBUyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsU0FBUztZQUN2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SUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQzVDLEtBQUssRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDLFlBQVk7WUFDdkMsV0FBVyxFQUFFLHNCQUFzQjtZQUNuQyxVQUFVLEVBQUUsNEJBQTRCLFdBQVcsRUFBRTtTQUN0RCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQzNDLEtBQUssRUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUc7WUFDM0IsV0FBVyxFQUFFLHFCQUFxQjtZQUNsQyxVQUFVLEVBQUUsdUJBQXVCLFdBQVcsRUFBRTtTQUNqRCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUN0QyxLQUFLLEVBQUUsV0FDTCxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUNyQixrREFDRSxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUNyQixvQkFBb0IsU0FBUyxDQUFDLGFBQWEsRUFBRTtZQUM3QyxXQUFXLEVBQUUsMEJBQTBCO1NBQ3hDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQS9IRCxzQ0ErSEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGFcIjtcbmltcG9ydCAqIGFzIGVjciBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWVjclwiO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbG9nc1wiO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBFbmNvZGluZ1N0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGVudmlyb25tZW50OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBFbmNvZGluZ1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGVjclJlcG9zaXRvcnk6IGVjci5JUmVwb3NpdG9yeTtcbiAgcHVibGljIHJlYWRvbmx5IGxhbWJkYUZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XG4gIHB1YmxpYyByZWFkb25seSBmdW5jdGlvblVybDogbGFtYmRhLkZ1bmN0aW9uVXJsO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBFbmNvZGluZ1N0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52aXJvbm1lbnQgfSA9IHByb3BzO1xuXG4gICAgLy8gRUNSIFJlcG9zaXRvcnkgZm9yIGNvbnRhaW5lciBpbWFnZXMgLSB1c2UgZXhpc3Rpbmcgb25lXG4gICAgdGhpcy5lY3JSZXBvc2l0b3J5ID0gZWNyLlJlcG9zaXRvcnkuZnJvbVJlcG9zaXRvcnlOYW1lKFxuICAgICAgdGhpcyxcbiAgICAgIFwiRW5jb2RpbmdSZXBvc2l0b3J5XCIsXG4gICAgICBgc2VzYW15LWVuY29kaW5nLSR7ZW52aXJvbm1lbnR9YFxuICAgICk7XG5cbiAgICAvLyBJQU0gUm9sZSBmb3IgTGFtYmRhXG4gICAgY29uc3QgbGFtYmRhUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCBcIkVuY29kaW5nTGFtYmRhUm9sZVwiLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbChcImxhbWJkYS5hbWF6b25hd3MuY29tXCIpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcbiAgICAgICAgICBcInNlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGVcIlxuICAgICAgICApLFxuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhVlBDQWNjZXNzRXhlY3V0aW9uUm9sZVwiXG4gICAgICAgICksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQ2xvdWRXYXRjaCBMb2cgR3JvdXBcbiAgICBjb25zdCBsb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsIFwiRW5jb2RpbmdMb2dHcm91cFwiLCB7XG4gICAgICBsb2dHcm91cE5hbWU6IGAvYXdzL2xhbWJkYS9zZXNhbXktZW5jb2RpbmctJHtlbnZpcm9ubWVudH1gLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuVFdPX1dFRUtTLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vIExhbWJkYSBGdW5jdGlvbiB3aXRoIENvbnRhaW5lciBJbWFnZVxuICAgIHRoaXMubGFtYmRhRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIFwiRW5jb2RpbmdGdW5jdGlvblwiLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6IGBzZXNhbXktZW5jb2RpbmctJHtlbnZpcm9ubWVudH1gLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUVjckltYWdlKHRoaXMuZWNyUmVwb3NpdG9yeSwge1xuICAgICAgICB0YWdPckRpZ2VzdDogXCJsYXRlc3RcIixcbiAgICAgIH0pLFxuICAgICAgaGFuZGxlcjogbGFtYmRhLkhhbmRsZXIuRlJPTV9JTUFHRSxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLkZST01fSU1BR0UsXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxuXG4gICAgICAvLyBNYXhpbXVtIGNvbmZpZ3VyYXRpb24gZm9yIGJpZ2dlc3QgTGFtYmRhXG4gICAgICBtZW1vcnlTaXplOiAxMDI0MCwgLy8gMTAgR0JcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSwgLy8gMTUgbWludXRlc1xuICAgICAgZXBoZW1lcmFsU3RvcmFnZVNpemU6IGNkay5TaXplLmdpYmlieXRlcygxMCksIC8vIDEwIEdCXG5cbiAgICAgIC8vIEVudmlyb25tZW50IHZhcmlhYmxlc1xuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgTk9ERV9FTlY6IGVudmlyb25tZW50LFxuICAgICAgfSxcblxuICAgICAgLy8gQXJjaGl0ZWN0dXJlIC0gdXNlIHg4Nl82NCBmb3IgRkZtcGVnIGNvbXBhdGliaWxpdHlcbiAgICAgIGFyY2hpdGVjdHVyZTogbGFtYmRhLkFyY2hpdGVjdHVyZS5YODZfNjQsXG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGEgRnVuY3Rpb24gVVJMIGZvciBkaXJlY3QgSFRUUCBhY2Nlc3NcbiAgICB0aGlzLmZ1bmN0aW9uVXJsID0gdGhpcy5sYW1iZGFGdW5jdGlvbi5hZGRGdW5jdGlvblVybCh7XG4gICAgICBhdXRoVHlwZTogbGFtYmRhLkZ1bmN0aW9uVXJsQXV0aFR5cGUuTk9ORSxcbiAgICAgIGNvcnM6IHtcbiAgICAgICAgYWxsb3dlZE9yaWdpbnM6IFtcIipcIl0sXG4gICAgICAgIGFsbG93ZWRNZXRob2RzOiBbbGFtYmRhLkh0dHBNZXRob2QuQUxMXSxcbiAgICAgICAgYWxsb3dlZEhlYWRlcnM6IFtcIipcIl0sXG4gICAgICAgIG1heEFnZTogY2RrLkR1cmF0aW9uLmhvdXJzKDI0KSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBDbG91ZFdhdGNoIERhc2hib2FyZCAob3B0aW9uYWwpXG4gICAgY29uc3QgZGFzaGJvYXJkID0gbmV3IGNkay5hd3NfY2xvdWR3YXRjaC5EYXNoYm9hcmQoXG4gICAgICB0aGlzLFxuICAgICAgXCJFbmNvZGluZ0Rhc2hib2FyZFwiLFxuICAgICAge1xuICAgICAgICBkYXNoYm9hcmROYW1lOiBgc2VzYW15LWVuY29kaW5nLSR7ZW52aXJvbm1lbnR9LSR7XG4gICAgICAgICAgY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvblxuICAgICAgICB9YCxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gQWRkIExhbWJkYSBtZXRyaWNzIHRvIGRhc2hib2FyZFxuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNkay5hd3NfY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIkxhbWJkYSBJbnZvY2F0aW9uc1wiLFxuICAgICAgICBsZWZ0OiBbdGhpcy5sYW1iZGFGdW5jdGlvbi5tZXRyaWNJbnZvY2F0aW9ucygpXSxcbiAgICAgIH0pLFxuICAgICAgbmV3IGNkay5hd3NfY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIkxhbWJkYSBEdXJhdGlvblwiLFxuICAgICAgICBsZWZ0OiBbdGhpcy5sYW1iZGFGdW5jdGlvbi5tZXRyaWNEdXJhdGlvbigpXSxcbiAgICAgIH0pLFxuICAgICAgbmV3IGNkay5hd3NfY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIkxhbWJkYSBFcnJvcnNcIixcbiAgICAgICAgbGVmdDogW3RoaXMubGFtYmRhRnVuY3Rpb24ubWV0cmljRXJyb3JzKCldLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiRUNSUmVwb3NpdG9yeVVyaVwiLCB7XG4gICAgICB2YWx1ZTogdGhpcy5lY3JSZXBvc2l0b3J5LnJlcG9zaXRvcnlVcmksXG4gICAgICBkZXNjcmlwdGlvbjogXCJFQ1IgUmVwb3NpdG9yeSBVUklcIixcbiAgICAgIGV4cG9ydE5hbWU6IGBzZXNhbXktZW5jb2RpbmctZWNyLSR7ZW52aXJvbm1lbnR9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTGFtYmRhRnVuY3Rpb25OYW1lXCIsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmxhbWJkYUZ1bmN0aW9uLmZ1bmN0aW9uTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkxhbWJkYSBGdW5jdGlvbiBOYW1lXCIsXG4gICAgICBleHBvcnROYW1lOiBgc2VzYW15LWVuY29kaW5nLWZ1bmN0aW9uLSR7ZW52aXJvbm1lbnR9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTGFtYmRhRnVuY3Rpb25VcmxcIiwge1xuICAgICAgdmFsdWU6IHRoaXMuZnVuY3Rpb25VcmwudXJsLFxuICAgICAgZGVzY3JpcHRpb246IFwiTGFtYmRhIEZ1bmN0aW9uIFVSTFwiLFxuICAgICAgZXhwb3J0TmFtZTogYHNlc2FteS1lbmNvZGluZy11cmwtJHtlbnZpcm9ubWVudH1gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJEYXNoYm9hcmRVcmxcIiwge1xuICAgICAgdmFsdWU6IGBodHRwczovLyR7XG4gICAgICAgIGNkay5TdGFjay5vZih0aGlzKS5yZWdpb25cbiAgICAgIH0uY29uc29sZS5hd3MuYW1hem9uLmNvbS9jbG91ZHdhdGNoL2hvbWU/cmVnaW9uPSR7XG4gICAgICAgIGNkay5TdGFjay5vZih0aGlzKS5yZWdpb25cbiAgICAgIH0jZGFzaGJvYXJkczpuYW1lPSR7ZGFzaGJvYXJkLmRhc2hib2FyZE5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkNsb3VkV2F0Y2ggRGFzaGJvYXJkIFVSTFwiLFxuICAgIH0pO1xuICB9XG59XG4iXX0=
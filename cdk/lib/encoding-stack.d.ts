import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";
export interface EncodingStackProps extends cdk.StackProps {
    environment: string;
}
export declare class EncodingStack extends cdk.Stack {
    readonly ecrRepository: ecr.IRepository;
    readonly lambdaFunction: lambda.Function;
    readonly functionUrl: lambda.FunctionUrl;
    readonly apiGateway: apigateway.RestApi;
    constructor(scope: Construct, id: string, props: EncodingStackProps);
}

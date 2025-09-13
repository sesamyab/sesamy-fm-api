#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const cdk = require("aws-cdk-lib");
const encoding_stack_1 = require("../lib/encoding-stack");
const app = new cdk.App();
// Get environment from context or default to dev
const environment = app.node.tryGetContext("environment") || "dev";
const region = app.node.tryGetContext("region") || "us-east-1";
new encoding_stack_1.EncodingStack(app, `SesamyEncodingStack-${environment}`, {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: region,
    },
    environment: environment,
    // Stack tags
    tags: {
        Project: "sesamy-encoding",
        Environment: environment,
        Service: "ffmpeg-lambda",
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2RrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY2RrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLHVDQUFxQztBQUNyQyxtQ0FBbUM7QUFDbkMsMERBQXNEO0FBRXRELE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLGlEQUFpRDtBQUNqRCxNQUFNLFdBQVcsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsSUFBSSxLQUFLLENBQUM7QUFDbkUsTUFBTSxNQUFNLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLElBQUksV0FBVyxDQUFDO0FBRS9ELElBQUksOEJBQWEsQ0FBQyxHQUFHLEVBQUUsdUJBQXVCLFdBQVcsRUFBRSxFQUFFO0lBQzNELEdBQUcsRUFBRTtRQUNILE9BQU8sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQjtRQUN4QyxNQUFNLEVBQUUsTUFBTTtLQUNmO0lBQ0QsV0FBVyxFQUFFLFdBQVc7SUFFeEIsYUFBYTtJQUNiLElBQUksRUFBRTtRQUNKLE9BQU8sRUFBRSxpQkFBaUI7UUFDMUIsV0FBVyxFQUFFLFdBQVc7UUFDeEIsT0FBTyxFQUFFLGVBQWU7S0FDekI7Q0FDRixDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG5pbXBvcnQgXCJzb3VyY2UtbWFwLXN1cHBvcnQvcmVnaXN0ZXJcIjtcbmltcG9ydCAqIGFzIGNkayBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IEVuY29kaW5nU3RhY2sgfSBmcm9tIFwiLi4vbGliL2VuY29kaW5nLXN0YWNrXCI7XG5cbmNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5cbi8vIEdldCBlbnZpcm9ubWVudCBmcm9tIGNvbnRleHQgb3IgZGVmYXVsdCB0byBkZXZcbmNvbnN0IGVudmlyb25tZW50ID0gYXBwLm5vZGUudHJ5R2V0Q29udGV4dChcImVudmlyb25tZW50XCIpIHx8IFwiZGV2XCI7XG5jb25zdCByZWdpb24gPSBhcHAubm9kZS50cnlHZXRDb250ZXh0KFwicmVnaW9uXCIpIHx8IFwidXMtZWFzdC0xXCI7XG5cbm5ldyBFbmNvZGluZ1N0YWNrKGFwcCwgYFNlc2FteUVuY29kaW5nU3RhY2stJHtlbnZpcm9ubWVudH1gLCB7XG4gIGVudjoge1xuICAgIGFjY291bnQ6IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX0FDQ09VTlQsXG4gICAgcmVnaW9uOiByZWdpb24sXG4gIH0sXG4gIGVudmlyb25tZW50OiBlbnZpcm9ubWVudCxcblxuICAvLyBTdGFjayB0YWdzXG4gIHRhZ3M6IHtcbiAgICBQcm9qZWN0OiBcInNlc2FteS1lbmNvZGluZ1wiLFxuICAgIEVudmlyb25tZW50OiBlbnZpcm9ubWVudCxcbiAgICBTZXJ2aWNlOiBcImZmbXBlZy1sYW1iZGFcIixcbiAgfSxcbn0pO1xuIl19
// Encoding service abstraction to support both Cloudflare Containers and AWS Lambda
export interface EncodingServiceConfig {
  type: "cloudflare" | "aws-lambda";
  cloudflare?: {
    container: DurableObjectNamespace;
  };
  awsLambda?: {
    functionUrl: string;
    apiKey?: string;
  };
}

export interface EncodingRequest {
  audioUrl: string;
  outputUrl: string;
  metadataUrl?: string; // URL to upload comprehensive metadata JSON
  outputFormat?: string;
  bitrate?: number;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  storageEndpoint?: string;
}

export interface EncodingResponse {
  success: boolean;
  jobId?: string;
  message?: string;
  error?: string;
  input?: {
    url: string;
    duration: number;
    channels: number;
    sampleRate: number;
    inputBitrate: number;
  };
  output?: {
    url: string;
    format: string;
    bitrate: number;
    size: number;
  };
  timestamp: string;
  environment?: string;
}

export interface MetadataRequest {
  audioUrl: string;
}

export interface Chapter {
  startTime: number; // in seconds
  endTime?: number; // in seconds
  title: string;
  url?: string;
  image?: string;
  toc: boolean; // table of contents flag (required)
}

export interface MetadataResponse {
  success: boolean;
  duration?: number;
  channels?: number;
  sampleRate?: number;
  inputBitrate?: number;
  chapters?: Chapter[];
  error?: string;
}

export class EncodingService {
  private config: EncodingServiceConfig;

  constructor(config: EncodingServiceConfig) {
    this.config = config;
  }

  async encode(request: EncodingRequest): Promise<EncodingResponse> {
    if (this.config.type === "cloudflare" && this.config.cloudflare) {
      return this.encodeWithCloudflare(request);
    } else if (this.config.type === "aws-lambda" && this.config.awsLambda) {
      return this.encodeWithLambda(request);
    } else {
      throw new Error("Invalid or incomplete encoding service configuration");
    }
  }

  async getMetadata(request: MetadataRequest): Promise<MetadataResponse> {
    if (this.config.type === "cloudflare" && this.config.cloudflare) {
      return this.getMetadataWithCloudflare(request);
    } else if (this.config.type === "aws-lambda" && this.config.awsLambda) {
      return this.getMetadataWithLambda(request);
    } else {
      throw new Error("Invalid or incomplete encoding service configuration");
    }
  }

  async testEncoding(
    outputFormat = "mp3",
    bitrate = 128
  ): Promise<EncodingResponse> {
    if (this.config.type === "cloudflare" && this.config.cloudflare) {
      return this.testWithCloudflare({ outputFormat, bitrate });
    } else if (this.config.type === "aws-lambda" && this.config.awsLambda) {
      return this.testWithLambda({ outputFormat, bitrate });
    } else {
      throw new Error("Invalid or incomplete encoding service configuration");
    }
  }

  async warmup(): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }> {
    if (this.config.type === "cloudflare" && this.config.cloudflare) {
      return this.warmupCloudflare();
    } else if (this.config.type === "aws-lambda" && this.config.awsLambda) {
      return this.warmupLambda();
    } else {
      throw new Error("Invalid or incomplete encoding service configuration");
    }
  }

  private async encodeWithCloudflare(
    request: EncodingRequest
  ): Promise<EncodingResponse> {
    const sessionId = `encode-${Date.now()}`;
    const containerId = this.config.cloudflare!.container.idFromName(sessionId);
    const container = this.config.cloudflare!.container.get(containerId);

    const response = await container.fetch("http://container/encode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    return await response.json<EncodingResponse>();
  }

  private async encodeWithLambda(
    request: EncodingRequest
  ): Promise<EncodingResponse> {
    const response = await fetch(
      `${this.config.awsLambda!.functionUrl}/encode`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.awsLambda!.apiKey && {
            Authorization: `Bearer ${this.config.awsLambda!.apiKey}`,
          }),
        },
        body: JSON.stringify(request),
      }
    );

    if (!response.ok) {
      throw new Error(`AWS Lambda encoding failed: ${response.statusText}`);
    }

    return await response.json<EncodingResponse>();
  }

  private async getMetadataWithCloudflare(
    request: MetadataRequest
  ): Promise<MetadataResponse> {
    const sessionId = `metadata-${Date.now()}`;
    const containerId = this.config.cloudflare!.container.idFromName(sessionId);
    const container = this.config.cloudflare!.container.get(containerId);

    const response = await container.fetch("http://container/metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    return await response.json<MetadataResponse>();
  }

  private async getMetadataWithLambda(
    request: MetadataRequest
  ): Promise<MetadataResponse> {
    const response = await fetch(
      `${this.config.awsLambda!.functionUrl}/metadata`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.awsLambda!.apiKey && {
            Authorization: `Bearer ${this.config.awsLambda!.apiKey}`,
          }),
        },
        body: JSON.stringify(request),
      }
    );

    if (!response.ok) {
      throw new Error(
        `AWS Lambda metadata request failed: ${response.statusText}`
      );
    }

    return await response.json<MetadataResponse>();
  }

  private async testWithCloudflare(params: {
    outputFormat: string;
    bitrate: number;
  }): Promise<EncodingResponse> {
    const sessionId = `test-${Date.now()}`;
    const containerId = this.config.cloudflare!.container.idFromName(sessionId);
    const container = this.config.cloudflare!.container.get(containerId);

    const response = await container.fetch("http://container/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    return await response.json<EncodingResponse>();
  }

  private async testWithLambda(params: {
    outputFormat: string;
    bitrate: number;
  }): Promise<EncodingResponse> {
    const response = await fetch(`${this.config.awsLambda!.functionUrl}/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.awsLambda!.apiKey && {
          Authorization: `Bearer ${this.config.awsLambda!.apiKey}`,
        }),
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`AWS Lambda test failed: ${response.statusText}`);
    }

    return await response.json<EncodingResponse>();
  }

  private async warmupCloudflare(): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }> {
    try {
      const sessionId = `warmup-${Date.now()}`;
      const containerId =
        this.config.cloudflare!.container.idFromName(sessionId);
      const container = this.config.cloudflare!.container.get(containerId);

      const response = await container.fetch("http://container/warmup", {
        method: "POST",
      });

      const result = (await response.json()) as { message?: string };
      return { success: true, message: result.message };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async warmupLambda(): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }> {
    try {
      const response = await fetch(
        `${this.config.awsLambda!.functionUrl}/warmup`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.config.awsLambda!.apiKey && {
              Authorization: `Bearer ${this.config.awsLambda!.apiKey}`,
            }),
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Warmup failed: ${response.statusText}`);
      }

      const result = (await response.json()) as { message?: string };
      return { success: true, message: result.message };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

// Factory function to create encoding service based on environment
export function createEncodingService(
  encodingContainer?: DurableObjectNamespace,
  awsLambdaUrl?: string,
  awsApiKey?: string
): EncodingService {
  // Check environment variable for preferred encoding service
  // Defaults to 'aws' (AWS Lambda) if not specified
  const preferredService = (
    process.env.ENCODING_SERVICE_PROVIDER || "aws"
  ).toLowerCase();

  console.log(`Encoding service preference: ${preferredService}`);

  // If AWS is preferred and Lambda URL is available, use AWS Lambda
  if (preferredService === "aws" && awsLambdaUrl) {
    console.log("Using AWS Lambda encoding service");
    return new EncodingService({
      type: "aws-lambda",
      awsLambda: {
        functionUrl: awsLambdaUrl,
        apiKey: awsApiKey,
      },
    });
  }

  // If Cloudflare is preferred and container is available, use Cloudflare
  if (preferredService === "cloudflare" && encodingContainer) {
    console.log("Using Cloudflare container encoding service");
    return new EncodingService({
      type: "cloudflare",
      cloudflare: {
        container: encodingContainer,
      },
    });
  }

  // Fallback logic: try the non-preferred option if available
  if (awsLambdaUrl) {
    console.log("Falling back to AWS Lambda encoding service");
    return new EncodingService({
      type: "aws-lambda",
      awsLambda: {
        functionUrl: awsLambdaUrl,
        apiKey: awsApiKey,
      },
    });
  } else if (encodingContainer) {
    console.log("Falling back to Cloudflare container encoding service");
    return new EncodingService({
      type: "cloudflare",
      cloudflare: {
        container: encodingContainer,
      },
    });
  } else {
    throw new Error("No encoding service configuration provided");
  }
}

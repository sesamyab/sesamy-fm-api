import { v4 as uuidv4 } from "uuid";
import { logger } from "../telemetry-cf";
import { PodcastEventType } from "./types";

// Edge-compatible CloudEvent interface
interface CloudEventData {
  specversion: string;
  type: string;
  source: string;
  id: string;
  time: string;
  data: any;
  subject?: string;
}

export class EventPublisher {
  private source: string;

  constructor() {
    this.source = process.env.SERVICE_NAME || "podcast-service";
  }

  async publish(
    eventType: PodcastEventType,
    data: any,
    subject?: string
  ): Promise<void> {
    const event: CloudEventData = {
      specversion: "1.0",
      type: eventType,
      source: this.source,
      id: uuidv4(),
      time: new Date().toISOString(),
      data,
      subject,
    };

    // For development, log events. In production, send to message broker
    logger.info("Event published", {
      eventType,
      eventId: event.id,
      subject,
      data,
    });

    // TODO: In production, publish to message broker (e.g., Kafka, RabbitMQ, etc.)
    // Example:
    // await this.messageProducer.send({
    //   topic: eventType,
    //   messages: [{
    //     value: JSON.stringify(event),
    //   }],
    // });
  }
}

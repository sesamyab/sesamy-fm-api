// Simple test to verify creative type functionality
const {
  CreativeType,
  CreateCreativeSchema,
} = require("./src/campaigns/schemas.ts");

// Test the CreativeType enum
console.log("CreativeType enum values:", CreativeType.options);

// Test creating a creative with different types
const testData = [
  { campaignId: "test-campaign", name: "Audio Creative", type: "audio" },
  { campaignId: "test-campaign", name: "Video Creative", type: "video" },
  { campaignId: "test-campaign", name: "Display Creative", type: "display" },
];

testData.forEach((data) => {
  try {
    const result = CreateCreativeSchema.parse(data);
    console.log(`✅ Valid creative: ${data.name} (${data.type})`);
  } catch (error) {
    console.error(
      `❌ Invalid creative: ${data.name} (${data.type})`,
      error.message
    );
  }
});

// Test invalid type
try {
  const result = CreateCreativeSchema.parse({
    campaignId: "test-campaign",
    name: "Invalid Creative",
    type: "invalid",
  });
  console.error("❌ Should have failed for invalid type");
} catch (error) {
  console.log("✅ Correctly rejected invalid type");
}

console.log("Creative type functionality test completed!");

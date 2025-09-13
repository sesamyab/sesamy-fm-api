#!/bin/bash

# RSS Preview Endpoint Test Script
# Make sure to set your JWT token and API base URL

API_BASE_URL="http://localhost:8787"
JWT_TOKEN="your-jwt-token-here"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🎙️  RSS Preview Endpoint Test${NC}"
echo "============================"

if [ "$JWT_TOKEN" = "your-jwt-token-here" ]; then
    echo -e "${RED}❌ Please set your JWT_TOKEN in the script first!${NC}"
    echo "   You can get a JWT token by calling the auth endpoint or using an existing one."
    exit 1
fi

# Test RSS feeds
declare -a test_feeds=(
    "https://feeds.npr.org/510289/podcast.xml"
    "https://feeds.simplecast.com/54nAGcIl"
    # Add more test feeds as needed
)

test_rss_feed() {
    local rss_url="$1"
    echo -e "\n📡 Testing RSS feed: ${rss_url}"
    
    response=$(curl -s -X POST "${API_BASE_URL}/shows/preview-rss" \
        -H "Authorization: Bearer ${JWT_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"rssUrl\": \"${rss_url}\"}")
    
    # Check if the response contains "success": true
    if echo "$response" | grep -q '"success":true'; then
        echo -e "${GREEN}✅ RSS parsing successful!${NC}"
        
        # Extract and display basic info using jq if available, otherwise use basic parsing
        if command -v jq &> /dev/null; then
            title=$(echo "$response" | jq -r '.data.title // "Unknown"')
            total_episodes=$(echo "$response" | jq -r '.data.totalEpisodes // 0')
            language=$(echo "$response" | jq -r '.data.language // "Not specified"')
            author=$(echo "$response" | jq -r '.data.author // "Not specified"')
            
            echo "   Title: $title"
            echo "   Episodes: $total_episodes"
            echo "   Language: $language" 
            echo "   Author: $author"
        else
            echo "   Response: $response"
            echo "   (Install 'jq' for prettier output)"
        fi
    else
        echo -e "${RED}❌ RSS parsing failed${NC}"
        echo "   Response: $response"
    fi
}

# Run tests
for feed in "${test_feeds[@]}"; do
    test_rss_feed "$feed"
    sleep 1  # Small delay between requests
done

echo -e "\n🏁 Tests completed!"

# Example of testing with a custom RSS URL
echo -e "\n${BLUE}To test with your own RSS URL:${NC}"
echo "bash test-rss-preview.sh"
echo "Or manually:"
echo "curl -X POST ${API_BASE_URL}/shows/preview-rss \\"
echo "  -H \"Authorization: Bearer \${JWT_TOKEN}\" \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -d '{\"rssUrl\": \"https://your-podcast-feed.com/rss.xml\"}'"

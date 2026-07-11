const DIFY_API_URL = process.env.DIFY_API_URL || "https://api.dify.ai/v1";
const DIFY_API_KEY = process.env.DIFY_API_KEY;

async function main() {
  if (!DIFY_API_KEY) {
    console.error("Error: DIFY_API_KEY is not set in the environment variables.");
    process.exit(1);
  }

  console.log("Using DIFY_API_URL:", DIFY_API_URL);
  console.log("Using DIFY_API_KEY:", DIFY_API_KEY.slice(0, 8) + "...");

  const testPayload = {
    inputs: {
      title: "10分钟学会 React Hooks",
      url: "https://www.bilibili.com/video/BV1xx411m7nD",
      platform: "bilibili",
      content_type: "video",
    },
    response_mode: "blocking",
    user: "test-runner",
  };

  console.log("Sending payload to Dify Workflow API...");
  try {
    const response = await fetch(`${DIFY_API_URL}/workflows/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DIFY_API_KEY}`,
      },
      body: JSON.stringify(testPayload),
    });

    console.log("HTTP Response Status:", response.status);
    const text = await response.text();
    console.log("Raw Response Content:\n", text);

    if (response.ok) {
      const data = JSON.parse(text);
      const outputs = data.data?.outputs || {};
      const summaryText =
        outputs.summary ||
        outputs.result ||
        outputs.text ||
        outputs.output ||
        Object.values(outputs)[0];

      console.log("\n--- Extracted Summary Text ---");
      console.log(summaryText);
      console.log("------------------------------");
    } else {
      console.error("Dify request failed.");
    }
  } catch (error: any) {
    console.error("Error occurred during fetch:", error.message);
  }
}

main().catch(console.error);

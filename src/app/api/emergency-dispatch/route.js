import twilio from "twilio";

export async function POST(request) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form-data payload." }, { status: 400 });
  }

  const video = formData.get("video");
  const audio = formData.get("audio");
  const detectedConfidence = formData.get("detectedConfidence");
  const source = formData.get("source");
  const timestamp = formData.get("timestamp");

  if (!video || !audio) {
    return Response.json({ error: "Video and audio evidence are required." }, { status: 400 });
  }

  const evidenceRelayUrl = process.env.EVIDENCE_RELAY_URL;
  if (evidenceRelayUrl) {
    try {
      const relayPayload = new FormData();
      relayPayload.append("video", video);
      relayPayload.append("audio", audio);
      relayPayload.append("detectedConfidence", String(detectedConfidence || ""));
      relayPayload.append("source", String(source || ""));
      relayPayload.append("timestamp", String(timestamp || ""));

      const relayResponse = await fetch(evidenceRelayUrl, {
        method: "POST",
        body: relayPayload,
      });

      if (!relayResponse.ok) {
        const relayText = await relayResponse.text();
        return Response.json(
          { error: "Evidence relay failed.", details: relayText },
          { status: 502 }
        );
      }
    } catch (relayError) {
      return Response.json(
        { error: "Unable to relay evidence.", details: relayError.message },
        { status: 502 }
      );
    }
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  const contactList = (process.env.EMERGENCY_CONTACT_NUMBERS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (accountSid && authToken && fromNumber && contactList.length > 0) {
    try {
      const client = twilio(accountSid, authToken);
      const messageBody =
        `SOS violence detected (confidence ${Math.round(Number(detectedConfidence || 0) * 100)}%). ` +
        `Source: ${source || "unknown"}. ` +
        `Time: ${timestamp || new Date().toISOString()}. ` +
        "Evidence package captured and relayed.";

      await Promise.all(
        contactList.map((to) =>
          client.messages.create({
            to,
            from: fromNumber,
            body: messageBody,
          })
        )
      );
    } catch (twilioError) {
      return Response.json(
        { error: "Failed to notify emergency contacts.", details: twilioError.message },
        { status: 502 }
      );
    }
  }

  return Response.json(
    {
      success: true,
      relayed: Boolean(evidenceRelayUrl),
      notifiedContacts: contactList.length,
    },
    { status: 200 }
  );
}

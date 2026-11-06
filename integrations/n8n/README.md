# Journal WhatsApp reminder

1. Import [the workflow JSON](journal-whatsapp-reminder.json) into n8n.
2. In **Journal reminder webhook**, select or create a **Header Auth** credential. Set the header name to `X-Journal-Reminder-Token` and use a unique, randomly generated secret of at least 20 characters as its value.
3. In **Send WhatsApp reminder**, select your WhatsApp Business Cloud credential, sender number, your own recipient number with country code, and an approved template. A suitable template body is “Browser Assistant could not confirm your journal submission. Open Aurora to check.” Set up the sender in [WhatsApp Business Cloud](https://docs.n8n.io/integrations/builtin/credentials/whatsapp/).
4. Publish the workflow and copy the **Production URL** from the webhook node. In the Browser Assistant Chrome toolbar popup, open **WhatsApp journal reminder**, paste that URL and the same webhook token, then choose **Enable**.
5. Open the Aurora journal until its portal clock is visible. After returning to **Assessments**, the last journal's estimated time remains visible in QA Control. The extension checks for a reminder approximately once a minute after allowing 45 seconds for the portal to confirm a submission at 30:00 remaining.

Chrome needs to be running and the device needs a connection at the time of the reminder. The journal tab can be closed once its clock has been observed. A confirmation seen by Browser Assistant suppresses the reminder for that journal. If you submit on another device, a reminder may still ask you to check. Each journal gets one webhook attempt to avoid duplicate messages after a timeout. The request contains a fixed event name and leaves the journal text and personal details on the device.

const fs = require("fs");
const readline = require("readline");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");

const express = require("express");

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const TOKEN_PATH = "token.json";
const app = express();

/*
  Reading credentials
*/
const credentials = JSON.parse(fs.readFileSync("credentials.json"));
const { client_secret, client_id, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

/*
  Node mailer setup & fctn to send email
*/
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    type: "OAuth2",
    user: "piyushhhagarwal@gmail.com",
    clientId: client_id,
    clientSecret: client_secret,
    refreshToken: "your-refresh-token",
    accessToken: "your-access-token",
  },
});

async function sendEmail(replyTo, subject, body) {
  const mailOptions = {
    from: "piyushhhagarwal@gmail.com",
    to: replyTo,
    subject: subject,
    text: body,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent:", info.response);
  } catch (error) {
    console.error("Error sending email:", error);
  }
}

/*
  Loading client secret
*/
fs.readFile("credentials.json", (err, content) => {
  if (err) return console.log("Error loading client secret file:", err);
  authorize(JSON.parse(content), main);
});

/*
  Authorize if token found
*/
function authorize(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.web;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  fs.readFile("token.json", (err, token) => {
    if (err) return getAccessToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/*
  Get the token(if already not present)
*/
function getAccessToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  console.log("Authorize this app by visiting this url:", authUrl);

  app.get("/", (req, res) => {
    // This route will handle the callback after the user authorizes the app
    const code = req.query.code;
    if (!code) {
      // No code received, redirect to the authorization URL
      res.redirect(authUrl);
    } else {
      // Code received, exchange it for tokens
      oAuth2Client.getToken(code, (err, token) => {
        if (err) return console.error("Error retrieving access token", err);
        oAuth2Client.setCredentials(token);
        // Store the token to disk for later program executions
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
        // Callback with the authenticated client
        callback(oAuth2Client);
        res.send("Authentication successful! You can close this page.");
      });
    }
  });
}

async function startApp(auth) {
  const gmail = google.gmail({ version: "v1", auth });
  let emailReducer = {
    newMails: { results: 0, emails: [] },
    unreadMails: {},
  };
  let repliedEmails = new Set();

  // 1. GET - All new emails
  function getNewEmails() {
    return new Promise((resolve, reject) => {
      gmail.users.messages.list(
        {
          userId: "me",
          labelIds: ["INBOX"],
        },
        (err, res) => {
          if (err) {
            console.error("Error listing messages:", err);
            reject(err);
            return;
          }

          const messages = res.data.messages;
          resolve(messages);
        }
      );
    });
  }

  // 2. REPLY - To new emails
  async function replyToEmail(messageId) {
    try {
      // Check if the email has already been replied to
      if (repliedEmails.has(messageId)) {
        console.log(`Email with ID ${messageId} has already been replied to.`);
        return;
      }

      // 1. Get the details of the original email
      const originalMessage = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
      });

      // 2. Extract the recipient address from the original email
      const toAddress = originalMessage.data.payload.headers.find(
        (header) => header.name === "To"
      )?.value;

      if (!toAddress) {
        console.error(`Recipient address not found in the original message.`);
        return;
      }

      // 3. Customize your auto-reply message here
      const autoReplyMessage =
        "Greetings from gmaily created with ❤️ by Piyush, see my other works: https://piyushsultaniya.netlify.app";

      // 4. Create the reply message
      const replyMessage = `To: ${toAddress}\r\nSubject: Re: ${
        originalMessage.data.payload.headers.find(
          (header) => header.name === "Subject"
        )?.value
      }\r\n\r\n${autoReplyMessage}`;

      // 5. Send the reply
      await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: Buffer.from(replyMessage).toString("base64"),
          threadId: messageId,
        },
      });

      // 6. Label the email as "gmailyReplied"
      await gmail.users.messages.modify({
        userId: "me",
        id: messageId,
        requestBody: {
          addLabelIds: ["gmailyReplied"],
        },
      });

      // After successfully sending a reply, add the email ID to the set
      repliedEmails.add(messageId);

      console.log(`Replied to email with ID: ${messageId}`);
    } catch (error) {
      console.error("Error replying to email:", error);
      throw error;
    }
  }

  // GET MAILS
  try {
    emailReducer.newMails.emails = await getNewEmails();
    emailReducer.newMails.results = emailReducer.newMails.emails.length;
  } catch (error) {
    console.error("Error getting new emails:", error);
    return;
  }

  console.log(emailReducer.newMails.results);

  // SEND REPLIES
  for (const email of emailReducer.newMails.emails) {
    try {
      console.log(`Processing email with ID: ${email.id}`);
      await replyToEmail(email.id);
    } catch (error) {
      console.error("Error processing email:", error);
    }
  }
}

async function main(auth) {
  startApp(auth);
}

/*
  Starting server
*/
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

/*
  Sending email on interval
*/
setInterval(() => {
  main(oAuth2Client);
}, Math.floor(Math.random() * (120000 - 45000 + 1) + 45000));

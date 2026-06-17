import Expo from 'expo-server-sdk';

let expoClient;

function getExpoClient() {
  if (!expoClient) {
    expoClient = new Expo();
  }
  return expoClient;
}

export async function sendExpoPushNotifications(tokens, { title, body, data = {} }) {
  const expo = getExpoClient();
  const validTokens = [...new Set(tokens)].filter((token) => Expo.isExpoPushToken(token));

  if (validTokens.length === 0) {
    return { sent: 0, invalidTokens: [] };
  }

  const messages = validTokens.map((token) => ({
    to: token,
    sound: 'default',
    title,
    body,
    data,
  }));

  const chunks = expo.chunkPushNotifications(messages);
  const invalidTokens = [];
  let sent = 0;

  for (const chunk of chunks) {
    const receipts = await expo.sendPushNotificationsAsync(chunk);
    receipts.forEach((receipt, index) => {
      if (receipt.status === 'ok') {
        sent += 1;
        return;
      }

      const token = chunk[index]?.to;
      if (
        token &&
        (receipt.details?.error === 'DeviceNotRegistered' ||
          receipt.details?.error === 'InvalidCredentials')
      ) {
        invalidTokens.push(token);
      }
    });
  }

  return { sent, invalidTokens };
}

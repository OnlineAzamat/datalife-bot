const axios = require('axios');

async function checkSubscription(userId, channelUsername, botToken) {
  try {
    const url = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${channelUsername}&user_id=${userId}`;
    const response = await axios.get(url);
    const status = response.data.result.status;

    // "left" → a'zo emas
    return status !== 'left';
  } catch (err) {
    console.error('Subscription check error:', err.message);
    return false;
  }
}

module.exports = checkSubscription;
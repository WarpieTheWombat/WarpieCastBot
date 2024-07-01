const { Telegraf } = require('telegraf');
const { NeynarAPIClient, CastParamType } = require('@neynar/nodejs-sdk');
const fs = require('fs');

const bot = new Telegraf('<TG BOT TOKEN HERE>'); // Bot token

// Store chat states
const chatStates = {};

// Store admin user IDs
let adminUserIds = [];

// Function to fetch and update admin user IDs for a chat
async function updateAdminUserIds(chatId) {
    try {
        const admins = await bot.telegram.getChatAdministrators(chatId);
        adminUserIds = admins.map(admin => admin.user.id.toString());
    } catch (error) {
        console.error('Error fetching admin user IDs:', error);
    }
}

// Command to start the bot
bot.command('startWarpie', (ctx) => {
    ctx.replyWithPhoto(
        { source: fs.createReadStream('./logo.png') }, // Replace with the path to your photo file
        { caption: 'Welcome to the Official Warpie Cast Bot ! 🪄 \n\nUse the /spark command to engage with a Warpcast cast.' }
    );
});

// Command to cancel monitoring
bot.command('fade', async (ctx) => {
    const chatId = ctx.chat.id;
    if (chatStates[chatId]) {
        chatStates[chatId].cancel = true; // Mark the state as canceled
        if (chatStates[chatId].lastMessageId) {
            try {
                await bot.telegram.deleteMessage(chatId, chatStates[chatId].lastMessageId);
            } catch (error) {
                console.error('Error deleting message:', error);
            }
        }
        ctx.reply('Monitoring has been cancelled');
        await unrestrictAllUsers(ctx); // Unrestrict all users when monitoring is cancelled
        delete chatStates[chatId]; // Reset the chat state
    } else {
        ctx.reply('There is no active monitoring to cancel');
    }
});

// Command to initiate monitoring
bot.command('spark', async (ctx) => {
    const chatId = ctx.chat.id;

    // Update the admin user IDs
    await updateAdminUserIds(chatId);

    const userId = ctx.from.id.toString();

    if (!adminUserIds.includes(userId)) {
        return ctx.reply('Only admins are authorized to use this command.');
    }

    // Set the chat state to expect a Warpcast link
    chatStates[chatId] = {
        awaitingLink: true,
        startTime: Math.floor(Date.now() / 1000),
        restrictedUsers: new Set(),
        cancel: false,
        lastMessageId: null // Track the last message ID
    };

    // Restrict all users
    await restrictAllUsers(ctx);

    // Send an MP4 video from the local directory
    ctx.replyWithVideo(
        { source: fs.createReadStream('./city.mp4') },
        { caption: 'Provide the URL of the Warpcast Cast to engage with' }
    );
});

// Function to validate URL
function isValidURL(string) {
    const urlPattern = new RegExp('^(https?:\\/\\/)?' + // protocol
        '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.?)+[a-z]{2,}|' + // domain name
        '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
        '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
        '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
        '(\\#[-a-z\\d_]*)?$', 'i'); // fragment locator
    return !!urlPattern.test(string);
}

// Function to monitor the post for engagement
async function monitorPost(ctx, postId, targetLikes, targetComments, targetReposts) {
    const chatId = ctx.chat.id;
    let achieved = false;

    while (!achieved) {
        if (chatStates[chatId] && chatStates[chatId].cancel) {
            await unrestrictAllUsers(ctx);
            return;
        }

        try {
            let postData = await fetchPostDataWithTimeout(postId);
            console.log(postData);
            let { likes, recasts, comments } = postData;

            if (likes >= targetLikes && comments >= targetComments && recasts >= targetReposts) {
                achieved = true;
                chatStates[chatId].muted = false;

                if (chatStates[chatId].lastMessageId) {
                    try {
                        await bot.telegram.deleteMessage(chatId, chatStates[chatId].lastMessageId);
                    } catch (error) {
                        console.error('Error deleting message:', error);
                    }
                }

                const message = await ctx.replyWithVideo(
                    { source: fs.createReadStream('./bump.mp4') },
                    { caption: `${postId}\n\nTargets reached! 🪄\n\nLikes: ${likes} / ${targetLikes}\nComments: ${comments} / ${targetComments}\nRecasts: ${recasts} / ${targetReposts}\n\nChat Unmuted` }
                );

                chatStates[chatId].lastMessageId = message.message_id;
                await unrestrictAllUsers(ctx);
                delete chatStates[chatId]; // Reset the chat state
            } else {
                if (chatStates[chatId].lastMessageId) {
                    try {
                        await bot.telegram.deleteMessage(chatId, chatStates[chatId].lastMessageId);
                    } catch (error) {
                        console.error('Error deleting message:', error);
                    }
                }

                const message = await ctx.replyWithVideo(
                    { source: fs.createReadStream('./falling.mp4') },
                    { caption: `${postId}\n\nCurrent engagement progress:\nLikes: ${likes} / ${targetLikes}\nComments: ${comments} / ${targetComments}\nRecasts: ${recasts} / ${targetReposts}` }
                );

                chatStates[chatId].lastMessageId = message.message_id;
                await new Promise((resolve) => setTimeout(resolve, 20000)); // Check every 20 seconds
            }
        } catch (error) {
            ctx.reply('Error fetching post data. Please try again later.');
            console.error('Error fetching post data:', error);
            await unrestrictAllUsers(ctx);
            delete chatStates[chatId]; // Reset the chat state
            return;
        }
    }
}

// Function to fetch post data from Warpcast API with timeout and retry logic
async function fetchPostDataWithTimeout(postId, retries = 3, timeout = 90000) {
    const client = new NeynarAPIClient('<NEYMAR API KEY HERE>');
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const response = await Promise.race([
                client.lookUpCastByHashOrWarpcastUrl(postId, CastParamType.Url),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), timeout))
            ]);
            return {
                likes: response.cast.reactions.likes_count || 0,
                recasts: response.cast.reactions.recasts_count || 0,
                comments: response.cast.replies.count || 0
            };
        } catch (error) {
            console.error('Error fetching post data from Warpcast API:', error);
            if (attempt < retries - 1) {
                console.log(`Retrying... (${attempt + 1}/${retries})`);
            } else {
                throw error;
            }
        }
    }
}

// Function to restrict all users in the chat except the bot
async function restrictAllUsers(ctx) {
    const chatId = ctx.chat.id;
    try {
        await bot.telegram.setChatPermissions(chatId, {
            can_send_messages: false,
        });
        console.log('Chat muted');
    } catch (error) {
        console.error('Error muting chat:', error);
    }
}

// Function to unrestrict all users in the chat
async function unrestrictAllUsers(ctx) {
    const chatId = ctx.chat.id;
    try {
        await bot.telegram.setChatPermissions(chatId, {
            can_send_messages: true,
            can_send_other_messages: true
        });
        console.log('Chat unmuted');
    } catch (error) {
        console.error('Error unmuting chat:', error);
    }
}

// Middleware to handle incoming messages
bot.on('message', async (ctx, next) => {
    const chatState = chatStates[ctx.chat.id];
    const messageDate = ctx.message.date;
    const currentDate = Math.floor(Date.now() / 1000);
    const userId = ctx.from.id;

    if (messageDate <= currentDate) {
        // Ignore messages from the past
        if (chatState && chatState.startTime && messageDate < chatState.startTime) {
            return;
        }
    }

    // Check for the /fade command in the middle of the conversation
    if (ctx.message.text === '/fade') {
        const chatId = ctx.chat.id;
        if (chatStates[chatId]) {
            chatStates[chatId].cancel = true; // Mark the state as canceled
            if (chatStates[chatId].lastMessageId) {
                try {
                    await bot.telegram.deleteMessage(chatId, chatStates[chatId].lastMessageId);
                } catch (error) {
                    console.error('Error deleting message:', error);
                }
            }
            ctx.reply('Monitoring has been cancelled');
            await unrestrictAllUsers(ctx); // Unrestrict all users when monitoring is cancelled
            delete chatStates[chatId]; // Reset the chat state
        } else {
            ctx.reply('There is no active monitoring to cancel');
        }
        return;
    }

    if (chatState) {
        if (chatState.awaitingLink) {
            const link = ctx.message.text;
            if (!isValidURL(link)) {
                return ctx.reply('Invalid Warpcast post link. Please provide a valid link.');
            }

            chatStates[ctx.chat.id] = {
                ...chatStates[ctx.chat.id],
                awaitingLink: false,
                postId: link,
                awaitingLikes: true
            };

            ctx.reply('Provide the target number of likes ❤️');
        } else if (chatState.awaitingLikes) {
            const targetLikes = parseInt(ctx.message.text, 10);
            if (isNaN(targetLikes)) {
                return ctx.reply('Invalid input. Please provide a valid number for target likes');
            }

            chatStates[ctx.chat.id] = {
                ...chatStates[ctx.chat.id],
                awaitingLikes: false,
                targetLikes: targetLikes,
                awaitingComments: true
            };

            ctx.reply('Provide the target number of comments 💬 ');
        } else if (chatState.awaitingComments) {
            const targetComments = parseInt(ctx.message.text, 10);
            if (isNaN(targetComments)) {
                return ctx.reply('Invalid input. Please provide a valid number for target comments');
            }

            chatStates[ctx.chat.id] = {
                ...chatStates[ctx.chat.id],
                awaitingComments: false,
                targetComments: targetComments,
                awaitingReposts: true
            };

            ctx.reply('Provide the target number of recasts 🪄');
        } else if (chatState.awaitingReposts) {
            const targetRecasts = parseInt(ctx.message.text, 10);
            if (isNaN(targetRecasts)) {
                return ctx.reply('Invalid input. Please provide a valid number for target recasts');
            }

            chatStates[ctx.chat.id] = {
                ...chatStates[ctx.chat.id],
                awaitingReposts: false,
                targetReposts: targetRecasts,
                muted: true
            };

            const { postId, targetLikes, targetComments, targetReposts } = chatStates[ctx.chat.id];

            ctx.reply('Sparking up Cast for Engagement ...');

            // Start monitoring the post
            monitorPost(ctx, postId, targetLikes, targetComments, targetReposts);
        } else if (chatState.muted) {
            // Ignore messages from muted users
            if (!adminUserIds.includes(userId.toString())) {
                return;
            }
        }
    } else {
        return next(); // Process the message if the chat is not in any awaiting state
    }
});

// Start the bot
bot.launch().then(() => {
    console.log('Bot is running...');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

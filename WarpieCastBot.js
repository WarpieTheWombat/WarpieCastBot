const { Telegraf } = require('telegraf');
const { NeynarAPIClient, CastParamType } = require('@neynar/nodejs-sdk');
const fs = require('fs');

const bot = new Telegraf('7230685778:AAEkae8J1gtm2s8WLkJGFJ3w_X3GQP1nBuA'); // Bot token

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
        { source: fs.createReadStream('./logo.png') },
        { caption: '<b>Welcome to the Official Warpie Cast Bot ! 🪄 \n\nUse the /spark command to engage with a Warpcast cast\nUse the /fade command to cancel at anytime \n\nPowered by @WarpieTheWombat - Mascot of Warpcast</b>\n\n🟣 https://warpcast.com/warpie.eth\n🔵 https://x.com/WarpieTheWombat', parse_mode: 'HTML' }
    );
});

// Command to cancel monitoring
bot.command('fade', async (ctx) => {
    const chatId = ctx.chat.id;
    if (chatStates[chatId]) {
        clearTimeout(chatStates[chatId].timeout); // Clear the timeout
        chatStates[chatId].cancel = true; // Mark the state as canceled
        if (chatStates[chatId].lastMessageId) {
            try {
                await bot.telegram.deleteMessage(chatId, chatStates[chatId].lastMessageId);
            } catch (error) {
                console.error('Error deleting message:', error);
            }
        }
        ctx.reply('Monitoring has been cancelled', { parse_mode: 'HTML' });
        await unrestrictAllUsers(ctx); // Unrestrict all users when monitoring is cancelled
        delete chatStates[chatId]; // Reset the chat state
    } else {
        ctx.reply('There is no active monitoring to cancel', { parse_mode: 'HTML' });
    }
});

// Command to initiate monitoring
bot.command('spark', async (ctx) => {
    const chatId = ctx.chat.id;

    // Update the admin user IDs
    await updateAdminUserIds(chatId);

    const userId = ctx.from.id.toString();

    if (!adminUserIds.includes(userId)) {
        return ctx.reply('<b>Only admins are authorized to use this command.</b>', { parse_mode: 'HTML' });
    }

    // Set the chat state to expect a Warpcast link
    chatStates[chatId] = {
        awaitingLink: true,
        startTime: Math.floor(Date.now() / 1000),
        restrictedUsers: new Set(),
        cancel: false,
        lastMessageId: null, // Track the last message ID
        timeout: null, // Track the timeout ID
        lastProvideMessageId: null, // Track the last "provide" message ID
        initialMetricsMessageId: null, // Track the initial metrics message ID
        lastUserMessageId: null, // Track the last user message ID
        urlPromptMessageId: null, // Track the URL prompt message ID
        initiatedBy: userId // Track the user who initiated the command
    };

    // Restrict all users
    await restrictAllUsers(ctx);

    // Send an MP4 video from the local directory
    const urlPromptMessage = await ctx.replyWithVideo(
        { source: fs.createReadStream('./city.mp4') },
        { caption: '<b>Provide the link to the Warpcast Cast to engage with</b>', parse_mode: 'HTML' }
    );

    chatStates[chatId].urlPromptMessageId = urlPromptMessage.message_id;
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

// Function to generate emoji progress bar
function generateEmojiProgress(count, emoji) {
    const maxEmojis = 10;
    return emoji.repeat(Math.min(count, maxEmojis));
}

// Function to monitor the post for engagement
async function monitorPost(ctx, postId, targetLikes, targetComments, targetReposts) {
    const chatId = ctx.chat.id;
    let achieved = false;

    // Set a timeout to cancel monitoring after 10 minutes
    chatStates[chatId].timeout = setTimeout(async () => {
        if (chatStates[chatId]) {
            ctx.reply('Monitoring has been cancelled due to timeout of 10 minutes\nChat Unmuted\n\nPowered by @WarpieTheWombat - Mascot of Warpcast\n\n🟣 https://warpcast.com/warpie.eth\n🔵 https://x.com/WarpieTheWombat');
            await unrestrictAllUsers(ctx); // Unrestrict all users when monitoring is cancelled
            delete chatStates[chatId]; // Reset the chat state
        }
    }, 10 * 60 * 1000); // 10 minutes

    while (!achieved) {
        if (chatStates[chatId] && chatStates[chatId].cancel) {
            clearTimeout(chatStates[chatId].timeout); // Clear the timeout
            await unrestrictAllUsers(ctx);
            return;
        }

        try {
            let postData = await fetchPostDataWithTimeout(postId);
            if (chatStates[chatId] && chatStates[chatId].cancel) {
                clearTimeout(chatStates[chatId].timeout); // Clear the timeout
                await unrestrictAllUsers(ctx);
                return;
            }

            console.log(postData);
            let { likes, recasts, comments } = postData;

            const likeEmojis = generateEmojiProgress(likes, '❤️ ');
            const commentEmojis = generateEmojiProgress(comments, '💬 ');
            const recastEmojis = generateEmojiProgress(recasts, '🪄 ');

            if (likes >= targetLikes && comments >= targetComments && recasts >= targetReposts) {
                achieved = true;
                clearTimeout(chatStates[chatId].timeout); // Clear the timeout if criteria met
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
                    { caption: `<b>${postId}\n\nTargets reached! 🪄\n\nLikes: ${likes} / ${targetLikes}  ${likeEmojis}\nComments: ${comments} / ${targetComments}  ${commentEmojis}\nRecasts: ${recasts} / ${targetReposts}  ${recastEmojis}\n\nPowered by @WarpieTheWombat - Mascot of Warpcast</b>\n\n🟣 https://warpcast.com/warpie.eth\n🔵 https://x.com/WarpieTheWombat`, parse_mode: 'HTML' }
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
                    { caption: `<b>${postId}\n\nCurrent engagement progress\n\nLikes: ${likes} / ${targetLikes} ${likeEmojis}\nComments: ${comments} / ${targetComments} ${commentEmojis}\nRecasts: ${recasts} / ${targetReposts} ${recastEmojis}</b>`, parse_mode: 'HTML' }
                );

                chatStates[chatId].lastMessageId = message.message_id;
                await new Promise((resolve) => setTimeout(resolve, 20000)); // Check every 20 seconds
            }
        } catch (error) {
            if (!chatStates[chatId] || chatStates[chatId].cancel) {
                return;
            }
            ctx.reply('<b>Error fetching post data. Please try again later.</b>', { parse_mode: 'HTML' });
            console.error('Error fetching post data:', error);
            clearTimeout(chatStates[chatId].timeout); // Clear the timeout if an error occurs
            await unrestrictAllUsers(ctx);
            delete chatStates[chatId]; // Reset the chat state
            return;
        }
    }
}

// Function to fetch post data from Warpcast API with timeout and retry logic
async function fetchPostDataWithTimeout(postId, retries = 3, timeout = 90000) {
    const client = new NeynarAPIClient('82ACE10C-82BC-4A1D-A3B3-A650B9D4BAB3');
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
            clearTimeout(chatStates[chatId].timeout); // Clear the timeout
            chatStates[chatId].cancel = true; // Mark the state as canceled
            if (chatStates[chatId].lastMessageId) {
                try {
                    await bot.telegram.deleteMessage(chatId, chatStates[chatId].lastMessageId);
                } catch (error) {
                    console.error('Error deleting message:', error);
                }
            }
            ctx.reply('Monitoring has been cancelled', { parse_mode: 'HTML' });
            await unrestrictAllUsers(ctx); // Unrestrict all users when monitoring is cancelled
            delete chatStates[chatId]; // Reset the chat state
        } else {
            ctx.reply('There is no active monitoring to cancel', { parse_mode: 'HTML' });
        }
        return;
    }

    if (chatState) {
        if (userId.toString() !== chatState.initiatedBy) {
            // Ignore messages from users other than the one who initiated the /spark command
            return;
        }

        if (chatState.awaitingLink) {
            const link = ctx.message.text;
            if (!isValidURL(link)) {
                return ctx.reply('<b>Invalid Warpcast post link. Please provide a valid link.</b>', { parse_mode: 'HTML' });
            }

            // Store the user message ID to delete later
            chatStates[ctx.chat.id].lastUserMessageId = ctx.message.message_id;

            // Delete the URL prompt message
            if (chatStates[ctx.chat.id].urlPromptMessageId) {
                try {
                    await bot.telegram.deleteMessage(ctx.chat.id, chatStates[ctx.chat.id].urlPromptMessageId);
                } catch (error) {
                    console.error('Error deleting message:', error);
                }
            }

            // Fetch the initial post data
            let postData;
            try {
                postData = await fetchPostDataWithTimeout(link);
            } catch (error) {
                return ctx.reply('<b>Error fetching initial post data. Please provide a valid link.</b>', { parse_mode: 'HTML' });
            }

            const { likes, recasts, comments } = postData;
            const likeEmojis = generateEmojiProgress(likes, '❤️ ');
            const commentEmojis = generateEmojiProgress(comments, '💬 ');
            const recastEmojis = generateEmojiProgress(recasts, '🪄 ');

            // Send initial metrics
            const metricsMessage = await ctx.reply(`<b>Initial Cast Metrics 🪄\n\nLikes: ${likes} ${likeEmojis}\nComments: ${comments} ${commentEmojis}\nRecasts: ${recasts} ${recastEmojis}</b>`, { parse_mode: 'HTML' });
            chatStates[ctx.chat.id].initialMetricsMessageId = metricsMessage.message_id;

            chatStates[ctx.chat.id] = {
                ...chatStates[ctx.chat.id],
                awaitingLink: false,
                postId: link,
                awaitingLikes: true
            };

            // Delete the previous "provide" message if exists
            if (chatStates[ctx.chat.id].lastProvideMessageId) {
                try {
                    await bot.telegram.deleteMessage(ctx.chat.id, chatStates[ctx.chat.id].lastProvideMessageId);
                } catch (error) {
                    console.error('Error deleting message:', error);
                }
            }

            const message = await ctx.reply('<b>Provide the target number of likes ❤️</b>', { parse_mode: 'HTML' });
            chatStates[ctx.chat.id].lastProvideMessageId = message.message_id;

        } else if (chatState.awaitingLikes) {
            const targetLikes = parseInt(ctx.message.text, 10);
            if (isNaN(targetLikes)) {
                return ctx.reply('<b>Invalid input. Please provide a valid number for target likes</b>', { parse_mode: 'HTML' });
            }

            // Delete the previous user message if exists
            if (chatStates[ctx.chat.id].lastUserMessageId) {
                try {
                    await bot.telegram.deleteMessage(ctx.chat.id, chatStates[ctx.chat.id].lastUserMessageId);
                } catch (error) {
                    console.error('Error deleting message:', error);
                }
            }

            // Store the new user message ID to delete later
            chatStates[ctx.chat.id].lastUserMessageId = ctx.message.message_id;

            chatStates[ctx.chat.id] = {
                ...chatStates[ctx.chat.id],
                awaitingLikes: false,
                targetLikes: targetLikes,
                awaitingComments: true
            };

            // Delete the previous "provide" message if exists
            if (chatStates[ctx.chat.id].lastProvideMessageId) {
                try {
                    await bot.telegram.deleteMessage(ctx.chat.id, chatStates[ctx.chat.id].lastProvideMessageId);
                } catch (error) {
                    console.error('Error deleting message:', error);
                }
            }

            const message = await ctx.reply('<b>Provide the target number of comments 💬</b>', { parse_mode: 'HTML' });
            chatStates[ctx.chat.id].lastProvideMessageId = message.message_id;
        } else if (chatState.awaitingComments) {
            const targetComments = parseInt(ctx.message.text, 10);
            if (isNaN(targetComments)) {
                return ctx.reply('<b>Invalid input. Please provide a valid number for target comments</b>', { parse_mode: 'HTML' });
            }

            // Delete the previous user message if exists
            if (chatStates[ctx.chat.id].lastUserMessageId) {
                try {
                    await bot.telegram.deleteMessage(ctx.chat.id, chatStates[ctx.chat.id].lastUserMessageId);
                } catch (error) {
                    console.error('Error deleting message:', error);
                }
            }

            // Store the new user message ID to delete later
            chatStates[ctx.chat.id].lastUserMessageId = ctx.message.message_id;

            chatStates[ctx.chat.id] = {
                ...chatStates[ctx.chat.id],
                awaitingComments: false,
                targetComments: targetComments,
                awaitingReposts: true
            };

            // Delete the previous "provide" message if exists
            if (chatStates[ctx.chat.id].lastProvideMessageId) {
                try {
                    await bot.telegram.deleteMessage(ctx.chat.id, chatStates[ctx.chat.id].lastProvideMessageId);
                } catch (error) {
                    console.error('Error deleting message:', error);
                }
            }

            const message = await ctx.reply('<b>Provide the target number of recasts 🪄</b>', { parse_mode: 'HTML' });
            chatStates[ctx.chat.id].lastProvideMessageId = message.message_id;
        } else if (chatState.awaitingReposts) {
            const targetRecasts = parseInt(ctx.message.text, 10);
            if (isNaN(targetRecasts)) {
                return ctx.reply('<b>Invalid input. Please provide a valid number for target recasts</b>', { parse_mode: 'HTML' });
            }

            // Delete the previous user message if exists
            if (chatStates[ctx.chat.id].lastUserMessageId) {
                try {
                    await bot.telegram.deleteMessage(ctx.chat.id, chatStates[ctx.chat.id].lastUserMessageId);
                } catch (error) {
                    console.error('Error deleting message:', error);
                }
            }

            chatStates[ctx.chat.id] = {
                ...chatStates[ctx.chat.id],
                awaitingReposts: false,
                targetReposts: targetRecasts,
                muted: true
            };

            const { postId, targetLikes, targetComments, targetReposts } = chatStates[ctx.chat.id];

            // Delete the previous "provide" message if exists
            if (chatStates[ctx.chat.id].lastProvideMessageId) {
                try {
                    await bot.telegram.deleteMessage(ctx.chat.id, chatStates[ctx.chat.id].lastProvideMessageId);
                } catch (error) {
                    console.error('Error deleting message:', error);
                }
            }

            // Delete the initial metrics message if exists
            if (chatStates[ctx.chat.id].initialMetricsMessageId) {
                try {
                    await bot.telegram.deleteMessage(ctx.chat.id, chatStates[ctx.chat.id].initialMetricsMessageId);
                } catch (error) {
                    console.error('Error deleting message:', error);
                }
            }

            // Delete the last user message for recasts
            try {
                await bot.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id);
            } catch (error) {
                console.error('Error deleting message:', error);
            }

            ctx.reply('<b>Sparking up Cast for Engagement ...</b>', { parse_mode: 'HTML' });

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

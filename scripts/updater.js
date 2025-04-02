const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const moment = require('moment-timezone');
const cheerio = require('cheerio');
require('dotenv').config();

// ##############################
//         Config
// ##############################
const CONFIG = {
    TIME_FORMAT: 'MMM D HH:mm [GMT]+8',
    CHANNEL_ID: process.env.CHANNEL_ID,
    TOKEN: process.env.DISCORD_TOKEN,
    IMAGE_PATH: path.resolve(__dirname, '../images/schedule.png'),
    DATA_PATH: path.resolve(__dirname, '../public/data.json'),
    OUTPUT_DIR: path.resolve(__dirname, 'public')
};

moment.locale('en-us');

// ##############################
//        Discord Client
// ##############################
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`🏃 ${client.user.tag} ready.`);
});

async function findLatestImage() {
    try {
        const channel = await client.channels.fetch(CONFIG.CHANNEL_ID);
        const messages = await channel.messages.fetch({ limit: 10 });

        for (const message of messages.values()) {
            if (message.attachments.size > 0) {
                const image = message.attachments.find(att => 
                    ['.png', '.jpg', '.webp'].some(ext => att.url.endsWith(ext))
                );
                if (image) return image.url;
                console.log('Image URL: ', `${image.url}`);
            }
        }
        throw new Error('No picture found in recent 10 messages.');

    } catch (error) {
        console.error('Messages scan failed:', error.message);
        process.exit(1);
    }
}

// ##############################
//        Files
// ##############################
async function downloadFile(url) {
    try {
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream'
        });

        if (!fs.existsSync(path.dirname(CONFIG.IMAGE_PATH))) {
            fs.mkdirSync(path.dirname(CONFIG.IMAGE_PATH), { recursive: true });
        }

        const writer = fs.createWriteStream(CONFIG.IMAGE_PATH);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log('✅ Picture updated');
                console.log('Image URL: ', `${url}`);
                resolve(true);
            });
            writer.on('error', reject);
        });
    } catch (error) {
        console.error('Download failed:', error.message);
        return false;
    }
}

// ##############################
//        Followers
// ##############################
async function getTwitchFollowers() {
    try {
        const { data } = await axios.get('https://twitchtracker.com/vedal987', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            },
        });

        const $ = cheerio.load(data);
        const followersElement = $('div.g-x-s-label:contains("Total followers")').parent().find('.g-x-s-value span:not(.g-x-s-value-addon)');
        const followersText = followersElement.text().trim();
        
        const cleanedText = followersText
            .replace(/,/g, '')
            .replace(/#/g, '');
            
        if (!/^\d+$/.test(cleanedText)) {
            throw new Error(`Invalid format: ${followersText}`);
        }
        
        const followers = parseInt(cleanedText, 10);
        return followers >= 1000 ? `${(followers / 1000).toFixed(0)}k` : followers.toString();
    } catch (error) {
        console.error('TwitchTracker request failed:', error.message);
        return '756k';
    }
}

async function getBilibiliFollowers() {
    try {
        const response = await axios.get('https://api.bilibili.com/x/relation/stat', {
            params: { vmid: '3546729368520811' },
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        const followers = response.data.data.follower;
        return followers >= 1000 ? `${(followers / 1000).toFixed(0)}k` : followers.toString();
    } catch (error) {
        console.error('Bilibili request failed:', error.message);
        return 'N/A';
    }
}

// ##############################
//        Json generate
// ##############################
async function generateDataFile(twitchFollowers, biliFollowers) {
    try {
        const now = moment()
            .tz('Asia/Shanghai')
            .format(CONFIG.TIME_FORMAT);

        const data = {
            lastUpdated: now,
            twitchFollowers,
            bilibiliFollowers: biliFollowers,
            imageUrl: 'images/schedule.png'
        };

        if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
            fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
        }

        fs.writeFileSync(CONFIG.DATA_PATH, JSON.stringify(data, null, 2));
        console.log('📊 JSON generated:', data);
    } catch (error) {
        console.error('JSON generation failed:', error.message);
    }
}

// ##############################
//        Main process
// ##############################
async function main() {
    try {
        await client.login(CONFIG.TOKEN);

        const twitchFollowers = await getTwitchFollowers();
        const biliFollowers = await getBilibiliFollowers();
        console.log('Get followers:', `Twitch: ${twitchFollowers}`);
        console.log('Get followers:', `Bilibili: ${biliFollowers}`);
        
        await Promise.all([
            generateDataFile(twitchFollowers, biliFollowers),
            (async () => {
                const imageUrl = await findLatestImage();
                await downloadFile(imageUrl);
            })()
        ]);
    } catch (error) {
        console.error('Main process failed:', error.message);
        process.exit(1);
    } finally {
        client.destroy();
        console.log('🔌 Discord client logout.');
    }
}

// 启动程序
main().catch(err => {
    console.error('ERROR:', err);
    process.exit(1);
});

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { ProxyAgent } = require('undici');
const axios = require('axios');
const moment = require('moment-timezone');
require('dotenv').config();
const token = process.env.token;
const channel_id = process.env.channel_id;

// 配置参数
const CONFIG = {
    PROXY: 'http://127.0.0.1:7890',
    CHANNEL_ID: channel_id,
    TOKEN: token,
    IMAGE_PATH: path.resolve(__dirname, '../images/schedule.png'),
    HTML_PATH: path.resolve(__dirname, '../index.html')
};

// 初始化代理
const proxyAgent = new HttpsProxyAgent(CONFIG.PROXY);
const undiciAgent = new ProxyAgent(CONFIG.PROXY);
require('undici').setGlobalDispatcher(undiciAgent);

// 时间格式化配置
moment.locale('en-us');
const TIME_FORMAT = 'MMM D HH:mm [GMT]+8'; // 示例：Jun 20 14:30 GMT+8

// 创建Discord客户端
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    ws: {
        agent: undiciAgent
    },
    rest: {
        agent: undiciAgent
    }
});

client.once('ready', () => {
    console.log(`🏃 机器人 ${client.user.tag} 已就绪`);
});

async function findLatestImage() {
    try {
        const channel = await client.channels.fetch(CONFIG.CHANNEL_ID);
        // 获取最新的10条消息加快查找速度
        const messages = await channel.messages.fetch({ limit: 10 });

        for (const [_, message] of messages) {
            if (message.attachments.size > 0) {
                const image = message.attachments.find(att => 
                    att.contentType?.startsWith('image/') || 
                    ['.png', '.jpg', '.webp'].some(ext => att.url.endsWith(ext))
                );
                if (image) return image.url;
            }
        }
        throw new Error('⚠️ 最近10条消息中未找到图片');

    } catch (error) {
        console.error('消息扫描失败:', error);
        process.exit(1);
    }
}

async function downloadFile(url) {
    try {
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream',
            httpsAgent: proxyAgent
        });

        // 确保目录存在
        if (!fs.existsSync(path.dirname(CONFIG.IMAGE_PATH))) {
            fs.mkdirSync(path.dirname(CONFIG.IMAGE_PATH), { recursive: true });
        }

        const writer = fs.createWriteStream(CONFIG.IMAGE_PATH);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log('✅ 图片已更新');
                resolve(true);
            });
            writer.on('error', reject);
        });
    } catch (error) {
        console.error('下载失败:', error.message);
        return false;
    }
}

function updateTimestamp() {
    try {
        // 生成符合北京时间且与当前示例一致的时间格式（03-13 11:00 GMT+8）
        const now = moment()
            .tz('Asia/Shanghai')
            .format('MMM D HH:mm [GMT]+8'); // 月份两位数字，24小时制

        const htmlContent = fs.readFileSync(CONFIG.HTML_PATH, 'utf8')
            // 精准替换锚文本内容，保留所有标签属性
            .replace(
                /(<span id="update-time" class="update-time tag"><a href="https:\/\/discord\.gg\/AkXMj7VHsc" target="_blank" style="color: #666666">Update@)[^<]*(<\/a><\/span>)/,
                `$1${now}$2`
            );

        fs.writeFileSync(CONFIG.HTML_PATH, htmlContent);
        console.log('🕒 链接时间戳更新成功');
    } catch (error) {
        console.error('⛔ 时间戳更新失败:', error.message);
    }
}

client.login(CONFIG.TOKEN).then(async () => {
    try {
        const imageUrl = await findLatestImage();
        if (await downloadFile(imageUrl)) {
            updateTimestamp();
        }
    } finally {
        client.destroy();
        process.exit(0);
    }
});

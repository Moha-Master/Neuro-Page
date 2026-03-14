import os
import json
import asyncio
import aiofiles
from datetime import datetime
import pytz
from pathlib import Path

import discord
import requests
from bs4 import BeautifulSoup
import schedule
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uvicorn
import yaml
from PIL import Image

# Load configuration
config_path = Path(__file__).parent / 'config.yaml'
with open(config_path, 'r', encoding='utf-8') as f:
    config = yaml.safe_load(f)

# Configuration
CONFIG = {
    'DISCORD_TOKEN': config['discord']['token'],
    'CHANNEL_ID': config['discord']['channel_id'],
    'TIMEZONE': 'Asia/Shanghai',
    'DATA_PATH': Path(__file__).parent / 'frontend' / 'public' / 'data.json',
    'IMAGE_PATH': Path(__file__).parent / 'frontend' / 'images' / 'schedule.png',
    'WEBP_PATH': Path(__file__).parent / 'frontend' / 'images' / 'schedule.webp',
    'SERVER_HOST': config['server']['host'],
    'SERVER_PORT': config['server']['port'],
    'CRON': config['updater']['cron'],
    'PROXY_ENABLED': config['updater']['proxy']['enabled'],
    'PROXY_ADDRESS': config['updater']['proxy']['address']
}

# Discord client
intents = discord.Intents.default()
intents.messages = True
intents.message_content = True
client = discord.Client(
    intents=intents,
    proxy=CONFIG['PROXY_ADDRESS'] if CONFIG['PROXY_ENABLED'] else None
)

async def find_latest_image():
    """Find the latest image from Discord channel."""
    try:
        channel = client.get_channel(CONFIG['CHANNEL_ID'])
        if not channel:
            channel = await client.fetch_channel(CONFIG['CHANNEL_ID'])
        
        # Ensure it's a text channel
        if not hasattr(channel, 'history'):
            raise Exception("Channel does not support message history")
        
        messages = [msg async for msg in channel.history(limit=10)]
        
        for message in messages:
            if not message:  # Skip if message is None
                continue
                
            image_url = None
            message_content = message.content or ''
            message_url = f"https://discord.com/channels/{message.guild.id if message.guild else '@me'}/{message.channel.id}/{message.id}"
            
            # Check attachments
            for attachment in message.attachments:
                if attachment.content_type and attachment.content_type.startswith('image/'):
                    image_url = attachment.url
                    break
            
            # Check embeds
            if not image_url:
                for embed in message.embeds:
                    if embed.image:
                        image_url = embed.image.url
                    elif embed.thumbnail:
                        image_url = embed.thumbnail.url
                    if image_url:
                        break
            
            # Check message content for URLs
            if not image_url and message_content:
                import re
                url_match = re.search(r'https?://[^\s]+\.(png|jpg|jpeg|webp|gif)', message_content, re.IGNORECASE)
                if url_match:
                    image_url = url_match.group(0)
            
            if image_url:
                return {
                    'image_url': image_url,
                    'message_content': message_content,
                    'message_url': message_url
                }
        
        raise Exception("No image found in recent messages")
    
    except Exception as e:
        print(f"Error finding image: {e}")
        return None

async def get_twitch_followers():
    """Get Twitch followers count from TwitchMetrics."""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9'
        }
        proxies = {'http': CONFIG['PROXY_ADDRESS'], 'https': CONFIG['PROXY_ADDRESS']} if CONFIG['PROXY_ENABLED'] else None
        response = requests.get('https://www.twitchmetrics.net/c/85498365-vedal987', headers=headers, proxies=proxies)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 查找Followers的dt标签
        followers_dt = soup.find('dt', string='Followers')
        if followers_dt:
            # 找到下一个dd标签
            followers_dd = followers_dt.find_next_sibling('dd')
            if followers_dd:
                followers_text = followers_dd.text.strip()
                # 清理文本（移除逗号）
                cleaned_text = followers_text.replace(',', '')
                if cleaned_text.isdigit():
                    followers = int(cleaned_text)
                    return followers  # 返回纯数字
        
        return 970647  # fallback with current known value as int
    except Exception as e:
        print(f"Error getting Twitch followers: {e}")
        return "970,647"

async def get_bilibili_followers():
    """Get Bilibili followers count from API."""
    try:
        url = 'https://api.bilibili.com/x/relation/stat'
        params = {'vmid': '3546729368520811'}
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        proxies = {'http': CONFIG['PROXY_ADDRESS'], 'https': CONFIG['PROXY_ADDRESS']} if CONFIG['PROXY_ENABLED'] else None
        
        response = requests.get(url, params=params, headers=headers, proxies=proxies)
        data = response.json()
        followers = data['data']['follower']
        return followers  # 返回纯数字
    except Exception as e:
        print(f"Error getting Bilibili followers: {e}")
        return 0  # 返回0作为错误时的默认值

async def download_image(image_url):
    """Download and convert image to WebP."""
    try:
        proxies = {'http': CONFIG['PROXY_ADDRESS'], 'https': CONFIG['PROXY_ADDRESS']} if CONFIG['PROXY_ENABLED'] else None
        response = requests.get(image_url, proxies=proxies)
        response.raise_for_status()
        
        # Ensure directory exists
        CONFIG['IMAGE_PATH'].parent.mkdir(parents=True, exist_ok=True)
        
        # Save original image
        with open(CONFIG['IMAGE_PATH'], 'wb') as f:
            f.write(response.content)
        
        # Convert to WebP
        with Image.open(CONFIG['IMAGE_PATH']) as img:
            # Convert to RGB if necessary
            if img.mode in ('RGBA', 'LA', 'P'):
                img = img.convert('RGB')
            img.save(CONFIG['WEBP_PATH'], 'WEBP', quality=80)
        
        print("✅ Picture updated and converted to WebP")
        print(f"Image URL: {image_url}")
        return True
    except Exception as e:
        print(f"Download or conversion failed: {e}")
        return False

def parse_schedule_message(message_text):
    """Parse Discord message text to extract schedule data."""
    schedule = []
    if not message_text:
        return schedule
    
    lines = message_text.split('\n')
    
    # Regex patterns from original script
    import re
    timestamp_regex = r'<t:(\d+):[FDRT]?>'
    custom_emoji_regex = r'<(a)?:[^:]+:\d+>'
    unicode_emoji_regex = r'(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])'
    mention_regex = r'<@!?\d+>|<@&\d+>'
    discord_link_regex = r'\[.*?\]\(<https://discord.com/channels/.*?>\)'
    leading_dash_regex = r'^\s*-\s*'
    
    for line in lines:
        trimmed_line = line.strip()
        if not trimmed_line:
            continue
        
        # Check if line starts with Discord timestamp
        first_timestamp_match = re.search(timestamp_regex, trimmed_line)
        if first_timestamp_match:
            unix_timestamp = int(first_timestamp_match.group(1))
            
            content = trimmed_line
            
            # Clean up Discord formatting
            content = re.sub(timestamp_regex, '', content)
            content = re.sub(custom_emoji_regex, '', content)
            content = re.sub(unicode_emoji_regex, '', content)
            content = re.sub(mention_regex, '', content)
            content = re.sub(discord_link_regex, '', content)
            content = re.sub(r'^\s*-\s*-\s*', '', content)
            content = re.sub(leading_dash_regex, '', content).strip()
            
            if content:
                schedule.append({
                    'time': unix_timestamp,
                    'content': content
                })
    
    print('Parsed Schedule:', schedule)
    return schedule

async def update_data():
    """Update data.json with latest information."""
    print("=" * 60)
    print("🔄 STARTING DATA UPDATE")
    print("=" * 60)
    
    try:
        # Check if Discord client is ready
        if not client.is_ready():
            print("❌ Discord client not ready, skipping update")
            return
        
        # Get followers
        twitch_followers = await get_twitch_followers()
        bilibili_followers = await get_bilibili_followers()
        print(f'📊 Get followers: Twitch: {twitch_followers}, Bilibili: {bilibili_followers}')
        
        # Get latest image and message
        image_data = await find_latest_image()
        if not image_data:
            print("❌ No image data found")
            return
        
        # Parse schedule from message content
        schedule_data = parse_schedule_message(image_data['message_content'])
        
        # Current time as timestamp
        tz = pytz.timezone(CONFIG['TIMEZONE'])
        now = datetime.now(tz)
        last_updated_timestamp = int(now.timestamp())
        
        # Prepare data
        data = {
            'lastUpdated': last_updated_timestamp,
            'twitchFollowers': twitch_followers,
            'bilibiliFollowers': bilibili_followers,
            'imageUrl': image_data['image_url'],
            'schedule': schedule_data
        }
        
        # Save to file
        async with aiofiles.open(CONFIG['DATA_PATH'], 'w', encoding='utf-8') as f:
            await f.write(json.dumps(data, indent=2, ensure_ascii=False))
        
        # Download image
        if image_data['image_url']:
            await download_image(image_data['image_url'])
        
        print(f"✅ Data updated at timestamp {last_updated_timestamp}")
        print(f"📄 JSON generated with {len(schedule_data)} schedule items")
        
    except Exception as e:
        print(f"❌ Error updating data: {e}")
        import traceback
        traceback.print_exc()
    
    print("=" * 60)
    print("🏁 DATA UPDATE COMPLETED")
    print("=" * 60)

# FastAPI app
app = FastAPI()

# Mount static files
frontend_path = Path(__file__).parent / 'frontend'
app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="static")

# Schedule updates
def run_update():
    """Wrapper function for scheduled updates."""
    asyncio.create_task(update_data())

def setup_scheduler():
    if CONFIG['CRON'] == "single":
        print("Single update mode: will update only on startup")
        return
    
    # Check for test mode (seconds)
    if CONFIG['CRON'].startswith("*/") and CONFIG['CRON'].endswith(" * * * * *"):
        # Scheduled mode: */N * * * * * means every N seconds
        try:
            seconds = int(CONFIG['CRON'].split("/")[1].split()[0])
            print(f"🧪 Scheduled mode: Scheduled updates every {seconds} seconds")
            schedule.every(seconds).seconds.do(run_update)
            return
        except (ValueError, IndexError):
            pass
    
    # Default: every hour at :00
    schedule.every().hour.at(":00").do(run_update)
    print("Scheduled updates every hour at :00")

@client.event
async def on_ready():
    print(f'🏃 {client.user} ready.')

async def run_discord_client():
    """Run Discord client in background."""
    try:
        await client.start(CONFIG['DISCORD_TOKEN'])
    except Exception as e:
        print(f"Discord client error: {e}")
    finally:
        await client.close()

async def run_scheduler():
    """Run the scheduler loop - check every second for pending tasks."""
    while True:
        schedule.run_pending()
        await asyncio.sleep(1)

async def startup_update():
    """Perform initial update after Discord client is ready."""
    # Wait for Discord client to be ready
    await client.wait_until_ready()
    print("🤖 Discord client ready, performing initial update...")
    await update_data()
    print("🚀 Initial update completed!")

async def main():
    """Main application entry point."""
    # Setup scheduler
    setup_scheduler()
    
    # Create tasks
    tasks = []
    
    # Discord client task
    tasks.append(asyncio.create_task(run_discord_client()))
    
    # Initial update task (waits for Discord to be ready)
    tasks.append(asyncio.create_task(startup_update()))
    
    # Scheduler task (if not single mode)
    if CONFIG['CRON'] != "single":
        tasks.append(asyncio.create_task(run_scheduler()))
    
    # Run FastAPI server
    config = uvicorn.Config(app, host=CONFIG['SERVER_HOST'], port=CONFIG['SERVER_PORT'])
    server = uvicorn.Server(config)
    tasks.append(asyncio.create_task(server.serve()))
    
    # Wait for all tasks
    await asyncio.gather(*tasks, return_exceptions=True)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Shutting down...")
    finally:
        print('🔌 Discord client logout.')
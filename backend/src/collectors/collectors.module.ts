import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CollectorsFactory } from './collectors.factory';

import { AppStoreCollector } from './app-store/app-store.collector';
import { BlogCollector } from './blog/blog.collector';
import { DevToCollector } from './dev-to/dev-to.collector';
import { ForumCollector } from './forum/forum.collector';
import { GitHubCollector } from './github/github.collector';
import { GooglePlayCollector } from './google-play/google-play.collector';
import { HackerNewsCollector } from './hacker-news/hacker-news.collector';
import { NewsCollector } from './news/news.collector';
import { ProductHuntCollector } from './product-hunt/product-hunt.collector';
import { RedditCollector } from './reddit/reddit.collector';
import { StackOverflowCollector } from './stackoverflow/stackoverflow.collector';
import { YouTubeCollector } from './youtube/youtube.collector';

import { CollectorQueueService } from './base/collector-queue.service';

import { DiscourseForumAdapter } from './forum/adapters/discourse-forum.adapter';

/**
 * Registers all external data-source collectors.
 *
 * HttpModule provides HttpService for collectors that call
 * remote APIs directly, such as RedditCollector.
 *
 * ConfigModule provides environment-based configuration
 * through ConfigService.
 *
 * @author Malak
 */
@Module({
  imports: [
    ConfigModule,
    HttpModule.register({
      timeout: 15_000,
      maxRedirects: 5,
    }),
  ],

  providers: [
    CollectorsFactory,

    RedditCollector,
    YouTubeCollector,
    GitHubCollector,
    StackOverflowCollector,

    ForumCollector,
    BlogCollector,
    NewsCollector,

    AppStoreCollector,
    GooglePlayCollector,

    HackerNewsCollector,
    ProductHuntCollector,
    DevToCollector,

    DiscourseForumAdapter,
    CollectorQueueService,
  ],

  exports: [CollectorsFactory, CollectorQueueService],
})
export class CollectorsModule { }
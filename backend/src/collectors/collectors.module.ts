import { Module } from '@nestjs/common';

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
 * Module grouping all collector implementations.
 *
 * Adding a new collector requires registering its class as a provider.
 * No Prisma enum or centralized source map is required.
 *
 * @author Malak
 */
@Module({
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
export class CollectorsModule {}

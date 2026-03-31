import * as cheerio from 'cheerio';
import { spawn } from 'child_process';
import { config } from '../utils/config';

// Cloudflare 등 봇 차단 회피를 위해 curl 기반 다운로더 구현
async function fetchWithCurl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const args = [
      '-s', '-L',
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      '-H', 'Accept-Language: ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      url
    ];
    
    const curl = spawn('curl', args);
    curl.stdout.on('data', (data) => output += data.toString());
    curl.stderr.on('data', () => {}); // 무시
    curl.on('error', (err) => reject(new Error('curl 실행 실패: ' + err.message)));
    curl.on('close', (code) => {
      // Cloudflare 403 차단 시 output 내용으로 검증해야 하지만 일단 반환
      resolve(output);
    });
  });
}

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
};

// ==========================================
// 1. 프로필 링크 파싱
// ==========================================

export function parseArcaIdFromHref(href: string | undefined): { type: 'fixed' | 'half'; arcaId: string; displayName?: string } | null {
  if (!href) return null;
  // /u/@닉네임 (고정닉) 또는 /u/@닉네임/회원번호 (반고닉)
  const match = href.match(/\/u\/@([^\/]+)(?:\/(\d+))?/);
  if (!match) return null;

  try {
    const nickname = decodeURIComponent(match[1]);
    const memberNumber = match[2];

    if (memberNumber) {
      return { type: 'half', arcaId: `half_${memberNumber}`, displayName: nickname };
    } else {
      return { type: 'fixed', arcaId: `fixed_${nickname}`, displayName: nickname };
    }
  } catch (e) {
    return null;
  }
}

// ==========================================
// 2. 게시글 댓글에서 토큰 찾기
// ==========================================
// 실제 댓글 DOM 구조 (2026-03 확인):
//   div.comment-wrapper > div.comment-item#c_{id}
//     .info-row > .user-info > a[href^="/u/@"]  (프로필 링크)
//     .info-row > .user-info > span.user-icon.user-fixed (고정닉 마커)
//     .message > .text > pre (댓글 내용)

export async function findTokenInPost(postUrl: string, expectedToken: string) {
  try {
    // 쿼리 파라미터나 해시가 섞여 있을 수 있으므로 기본 URL 추출
    const baseUrl = postUrl.split('?')[0].split('#')[0];

    // 내부 헬퍼: 특정 URL의 페이지를 다운받고 토큰을 검색하며, 존재하는 최대 페이지 수도 반환
    const checkPage = async (url: string) => {
      const html = await fetchWithCurl(url);
      
      if (!html || html.length < 1000) throw new Error('Cloudflare 차단 혹은 응답이 비정상적입니다.');
      
      const $ = cheerio.load(html);

      let foundProfileHref: string | undefined = undefined;
      let foundDisplayName: string | undefined = undefined;

      // 댓글 순회
      $('.comment-item').each((_, el) => {
        if (foundProfileHref) return; // 이미 찾았으면 스킵
        const textContent = $(el).find('.message .text pre').text().trim();

        if (textContent.includes(expectedToken)) {
          const userInfoEl = $(el).find('.user-info');
          const profileLink = userInfoEl.find('a[href^="/u/@"]');
          
          if (profileLink.length > 0) {
            const href = profileLink.attr('href');
            const parsed = parseArcaIdFromHref(href);

            if (!parsed) return;
            if (!config.ALLOW_HALF_NICK && parsed.type === 'half') return; // 반고닉 비허용

            foundProfileHref = href;
            foundDisplayName = profileLink.text().trim();
          }
        }
      });

      // 최대 댓글 페이지(cp) 확인
      let maxCp = 1;
      $('.pagination .page-link').each((_, el) => {
        const title = $(el).attr('title') || '';
        const match = title.match(/(\d+)페이지/);
        if (match) {
          const pageNum = parseInt(match[1], 10);
          if (pageNum > maxCp) maxCp = pageNum;
        }
      });

      let result = null;
      if (foundProfileHref) {
        result = parseArcaIdFromHref(foundProfileHref);
        if (result && foundDisplayName) {
          result.displayName = foundDisplayName;
        }
      }

      return { result, maxCp };
    };

    // 1. 처음엔 1페이지를 검사 (해당 URL에 바로 접속)
    const firstCheck = await checkPage(`${baseUrl}?cp=1`);
    if (firstCheck.result) return firstCheck.result;

    // 2. 토큰을 못 찾았고, 2페이지 이상이 존재한다면, 최신 댓글이 작성되는 '마지막 페이지'부터 2페이지까지 역순으로 탐색
    if (firstCheck.maxCp > 1) {
      for (let cp = firstCheck.maxCp; cp >= 2; cp--) {
        // 불필요한 서버 부하를 막기 위해 짧은 딜레이 추가 (선택적)
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const pageCheck = await checkPage(`${baseUrl}?cp=${cp}`);
        if (pageCheck.result) return pageCheck.result;
      }
    }

    return null;
  } catch (error) {
    console.error('Crawler Error (findTokenInPost):', error);
    throw new Error('인증 게시물을 크롤링하는 데 실패했습니다. 아카라이브 서버 응답 지연이거나 Cloudflare 차단일 수 있습니다.');
  }
}

// ==========================================
// 3. 프로필 페이지 활동량 검증
// ==========================================
// 실제 프로필 DOM 구조 (2026-03 확인):
//
// [히트맵] div.user-activites
//   > div.block-row.row-{0~50+}    (각 주 = 7일)
//     > div.block-part.pattern-{N}  (N=0: 비활동, N>=1: 활동)
//   row-0 = 최근 주, 마지막 row = 가장 오래된 주
//
// [활동 목록] div.card-block
//   > h5 ("최근 작성글" / "최근 작성 댓글")
//   > div.user-recent
//     > div.col-title
//       > a[href^="/b/채널명"] > span.badge.category-badge  (채널 뱃지)
//       > a[href^="/b/채널명/게시글번호"]                     (게시글 링크)
//     > div.col-date > time[datetime]                       (일시)

export interface ProfileValidationResult {
  passed: boolean;
  reason?: string;
  details?: {
    activeDays?: number;
    channelPosts?: number;
  };
}

export async function validateProfileActivity(profileHref: string): Promise<ProfileValidationResult> {
  try {
    // profileHref는 `/u/@닉네임` 또는 `/u/@닉네임/번호` 형태
    const profileUrl = `https://arca.live${profileHref}`;
    const html = await fetchWithCurl(profileUrl);
    
    if (!html || html.length < 1000) {
      return { passed: false, reason: '프로필 데이터를 가져올 수 없거나 Cloudflare 차단입니다.' };
    }

    const $ = cheerio.load(html);

    // 프로필 비공개/404 체크
    if ($('.error-page').length > 0) {
      return { passed: false, reason: '프로필이 비공개이거나 존재하지 않습니다.' };
    }

    // ─── Step 1: 히트맵 기반 활동일수 체크 (MIN_ACTIVE_DAYS) ───
    let activeDays = 0;
    if (config.MIN_ACTIVE_DAYS !== Infinity) {
      // .block-part 중 pattern-0이 아닌 것(활동한 날) 카운트
      const allBlocks = $('.user-activites .block-part');
      allBlocks.each((_, el) => {
        const classes = $(el).attr('class') || '';
        // pattern-0이 아닌 모든 패턴(pattern-1, pattern-2, ...)이 활동일
        if (classes.includes('block-part') && !classes.includes('pattern-0')) {
          activeDays++;
        }
      });

      if (activeDays < config.MIN_ACTIVE_DAYS) {
        return {
          passed: false,
          reason: `히트맵 활동 일수 부족 (${activeDays}일 / 최소 ${config.MIN_ACTIVE_DAYS}일 필요)`,
          details: { activeDays }
        };
      }
    }

    // ─── Step 2: 최근 활동 기한 체크 (MAX_INACTIVE_DAYS) ───
    if (config.MAX_INACTIVE_DAYS !== Infinity) {
      const firstTime = $('.user-recent time').first().attr('datetime');
      if (firstTime) {
        const lastActivityMs = new Date(firstTime).getTime();
        const daysSinceLast = Math.floor((Date.now() - lastActivityMs) / (24 * 60 * 60 * 1000));
        
        if (daysSinceLast > config.MAX_INACTIVE_DAYS) {
          return {
            passed: false,
            reason: `최근 활동이 너무 오래되었습니다 (${daysSinceLast}일 전 / 최대 ${config.MAX_INACTIVE_DAYS}일 이내 필요)`
          };
        }
      } else {
        // time 태그가 아예 없으면 활동 내역 없음
        return { passed: false, reason: '프로필에서 활동 내역을 확인할 수 없습니다.' };
      }
    }

    // ─── Step 3: 대상 채널 활동량 체크 (TARGET_CHANNELS + MIN_CHANNEL_POSTS) ───
    let channelPosts = 0;
    if (config.TARGET_CHANNELS.length > 0 && config.MIN_CHANNEL_POSTS !== Infinity) {
      // 채널 뱃지 링크: a[href="/b/채널명"] (정확히 채널 루트만 매치, 게시글 링크 제외)
      $('.user-recent .col-title a[href^="/b/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        // /b/channelName (슬래시 뒤에 숫자 없음) → 채널 뱃지 링크만 매치
        const match = href.match(/^\/b\/([^\/]+)$/);
        if (match && config.TARGET_CHANNELS.includes(match[1])) {
          channelPosts++;
        }
      });

      if (channelPosts < config.MIN_CHANNEL_POSTS) {
        return {
          passed: false,
          reason: `대상 채널 활동 부족 (${channelPosts}개 / 최소 ${config.MIN_CHANNEL_POSTS}개 필요)`,
          details: { channelPosts }
        };
      }
    }

    return { passed: true, details: { activeDays, channelPosts } };
  } catch (error) {
    console.error('Crawler Error (validateProfileActivity):', error);
    throw new Error('유저 프로필을 조회하는 데 실패했습니다.');
  }
}

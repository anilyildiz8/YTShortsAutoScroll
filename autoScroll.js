(function () {
    'use strict';

    let isAutoScrollOn = false;
    let isWaiting = false;
    let wasAutoScrollOnBeforeComments = false;
    let commentObserver = null;
    let videoElementObserver = null;
    let video = null;
    let handlers = {};
    const toggleTextOn = 'Auto Scroll: ON';
    const toggleTextOff = 'Auto Scroll: OFF';

    const isShortsUrl = () => location.pathname.includes('/shorts/') || location.href.includes('youtube.com/shorts');
    const safeQ = s => { try { return document.querySelector(s); } catch { return null; } };

    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }

    function isCommentsSectionOpen() {
        const section = safeQ('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]');
        if (section) {
            const v = section.getAttribute('visibility');
            if (v) return v === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';
        }
        const comments = safeQ('ytd-comments, #comments');
        if (!comments) return false;
        const style = window.getComputedStyle(comments);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
        const rect = comments.getBoundingClientRect();
        return rect.height > 20 && rect.width > 20;
    }

    function goToNextShort() {
        const nextButton = safeQ('button[aria-label*="next" i], button[title*="next" i], .ytp-shorts-navigation-button-down');
        if (nextButton) return nextButton.click();
        const reel = safeQ('#shorts-container, ytd-reel-shelf-renderer');
        if (reel) return reel.scrollBy(0, window.innerHeight);
        window.scrollBy(0, window.innerHeight);
    }

    function detachVideoHandlers() {
        if (!video) return;
        if (handlers.ended) video.removeEventListener('ended', handlers.ended);
        if (handlers.timeupdate) video.removeEventListener('timeupdate', handlers.timeupdate);
        if (handlers.seeked) video.removeEventListener('seeked', handlers.seeked);
        handlers = {};
        if (isCommentsSectionOpen() && wasAutoScrollOnBeforeComments && video) video.loop = true;
        else if (video) video.loop = false;
        isWaiting = false;
        video = null;
    }

    function attachVideoHandlers(v) {
        detachVideoHandlers();
        if (!v) return;

        video = v;
        video.loop = false;

        const triggerThreshold = 0.25;
        let hasTriggeredNearEnd = false;

        function tryTriggerNearEnd() {
            if (
                !hasTriggeredNearEnd &&
                video.duration > 0 &&
                (video.ended || video.currentTime >= video.duration - triggerThreshold)
            ) {
                hasTriggeredNearEnd = true;
                nearEndHandler();
            }
        }

        handlers.ended = tryTriggerNearEnd;
        handlers.timeupdate = tryTriggerNearEnd;
        handlers.seeked = tryTriggerNearEnd;

        video.addEventListener('ended', handlers.ended);
        video.addEventListener('timeupdate', handlers.timeupdate);
        video.addEventListener('seeked', handlers.seeked);

        video.addEventListener('play', () => {
            hasTriggeredNearEnd = false;
        });

        const player = safeQ('ytd-player, .html5-video-player');
        if (player && typeof player.setLoop === 'function') {
            try { player.setLoop(false); } catch {}
        }

        const watchdog = setInterval(() => {
            if (video && !hasTriggeredNearEnd) tryTriggerNearEnd();
            else clearInterval(watchdog);
        }, 200);
    }

    function nearEndHandler() {
        if (!isAutoScrollOn || isWaiting || !video) return;
        video.pause();
        isWaiting = true;

        if (isCommentsSectionOpen()) {
            wasAutoScrollOnBeforeComments = true;
            isAutoScrollOn = false;
            video.loop = true;
            video.currentTime = 0;
            video.play().catch(() => {});
            updateToggleText(toggleTextOff);
        } else {
            video.loop = false;
            goToNextShort();
        }

        isWaiting = false;
    }

    function ensureToggleButton() {
        if (document.getElementById('autoScrollToggle')) return document.getElementById('autoScrollToggle');
        const wrapper = document.createElement('div');
        wrapper.id = 'autoScrollToggleWrap';
        wrapper.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647';
        const btn = document.createElement('button');
        btn.id = 'autoScrollToggle';
        btn.textContent = toggleTextOff;
        btn.style.cssText = 'padding:10px;background:#007bff;color:white;border:none;border-radius:5px;cursor:pointer;font-size:13px';
        wrapper.appendChild(btn);
        document.body.appendChild(wrapper);
        btn.addEventListener('click', toggleClicked);
        return btn;
    }

    function updateToggleText(text) {
        const btn = document.getElementById('autoScrollToggle');
        if (btn) btn.textContent = text;
    }

    function getVideoElement() {
        return safeQ('ytd-shorts video, ytd-reel-video-renderer video, ytd-reel-player-overlay-renderer video');
    }

    function toggleClicked() {
        isAutoScrollOn = !isAutoScrollOn;
        updateToggleText(isAutoScrollOn ? toggleTextOn : toggleTextOff);
        const v = getVideoElement();
        if (isAutoScrollOn) {
            if (isCommentsSectionOpen() && v) {
                isAutoScrollOn = false;
                wasAutoScrollOnBeforeComments = false;
                updateToggleText(toggleTextOff);
                v.loop = true;
                v.play().catch(() => {});
            } else attachVideoHandlers(v);
        } else detachVideoHandlers();
    }

    function updateButtonVisibility() {
        const wrap = document.getElementById('autoScrollToggleWrap');
        if (wrap) wrap.style.display = isShortsUrl() ? 'block' : 'none';
    }

    function observeCommentSection() {
        if (commentObserver) {
            commentObserver.disconnect();
            commentObserver = null;
        }

        const commentsSection = safeQ('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]');
        if (!commentsSection) {
            waitForElement('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]', 5000)
                .then(() => observeCommentSection())
                .catch(() => {});
            return;
        }

        const handleCommentChange = debounce(() => {
            const section = safeQ('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]');
            if (!section) return;
            const nowOpen = section.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';

            if (nowOpen && isAutoScrollOn) {
                wasAutoScrollOnBeforeComments = true;
                isAutoScrollOn = false;
                updateToggleText(toggleTextOff);
                const v = getVideoElement();
                if (v) { v.loop = true; v.currentTime = 0; v.play().catch(() => {}); detachVideoHandlers(); }
            }

            if (!nowOpen && wasAutoScrollOnBeforeComments) {
                isAutoScrollOn = true;
                wasAutoScrollOnBeforeComments = false;
                updateToggleText(toggleTextOn);
                const v = getVideoElement();
                if (v) { v.loop = false; attachVideoHandlers(v); v.play().catch(() => {}); }
            }
        }, 100);

        commentObserver = new MutationObserver(handleCommentChange);
        commentObserver.observe(commentsSection, { attributes: true, attributeFilter: ['visibility'] });
    }

    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = safeQ(selector);
            if (element) return resolve(element);

            let timeoutId;
            const observer = new MutationObserver(() => {
                const el = safeQ(selector);
                if (el) {
                    observer.disconnect();
                    clearTimeout(timeoutId);
                    resolve(el);
                }
            });

            const container = safeQ('ytd-app') || document.body;
            observer.observe(container, { childList: true, subtree: true });

            timeoutId = setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element ${selector} not found within ${timeout}ms`));
            }, timeout);
        });
    }

    function observeVideoElement() {
        if (videoElementObserver) {
            videoElementObserver.disconnect();
            videoElementObserver = null;
        }

        const handleVideoChange = debounce(() => {
            const v = getVideoElement();
            if (v && isAutoScrollOn && v !== video) {
                attachVideoHandlers(v);
            }
        }, 150);

        const shortsContainer = safeQ('ytd-shorts, ytd-reel-video-renderer, #shorts-container');
        if (shortsContainer) {
            videoElementObserver = new MutationObserver(handleVideoChange);
            videoElementObserver.observe(shortsContainer, { childList: true, subtree: true });
        }
    }

    async function onEnterShorts() {
        try {
            await waitForElement('ytd-shorts, ytd-reel-video-renderer');
            ensureToggleButton();
            updateButtonVisibility();
            observeCommentSection();
            observeVideoElement();

            const v = getVideoElement();
            if (v && isAutoScrollOn) attachVideoHandlers(v);
        } catch {}
    }

    function onLeaveShorts() {
        const wrap = document.getElementById('autoScrollToggleWrap');
        if (wrap) wrap.remove();

        if (commentObserver) { commentObserver.disconnect(); commentObserver = null; }
        if (videoElementObserver) { videoElementObserver.disconnect(); videoElementObserver = null; }

        isAutoScrollOn = false;
        wasAutoScrollOnBeforeComments = false;
        isWaiting = false;
        detachVideoHandlers();
        video = null;
        handlers = {};
        updateToggleText(toggleTextOff);
    }

    function setupLocationWatcher() {
        const handleLocationChange = debounce(() => {
            if (isShortsUrl()) onEnterShorts();
            else onLeaveShorts();
            updateButtonVisibility();
        }, 100);

        const emit = () => {
            window.dispatchEvent(new Event('locationchange'));
            handleLocationChange();
        };

        const _push = history.pushState;
        history.pushState = function () { _push.apply(this, arguments); emit(); };
        const _replace = history.replaceState;
        history.replaceState = function () { _replace.apply(this, arguments); emit(); };
        window.addEventListener('popstate', emit);
        window.addEventListener('yt-navigate-finish', handleLocationChange);
    }

    setupLocationWatcher();
    if (isShortsUrl()) onEnterShorts();
})();
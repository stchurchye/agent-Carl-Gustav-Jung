import type { ErrorCode } from './codes.js';

export interface ErrorMessageEntry {
  message: string;
  hint: string;
  retryable: boolean;
}

export const errorMessages: Record<ErrorCode, ErrorMessageEntry> = {
  NET_OFFLINE: {
    message: '现在连不上网，不是您的问题。打开无线网或流量后我们再试',
    hint: '文稿已保存在手机里，不会丢',
    retryable: true,
  },
  NET_TIMEOUT: {
    message: '等得有点久了，网络可能不太稳',
    hint: '您写的内容都还在，不会丢',
    retryable: true,
  },
  AI_BUSY: {
    message: 'Bow wow 这会儿有点忙，请喝口水，一分钟后再试',
    hint: '请稍等一会儿再试',
    retryable: true,
  },
  AI_REFUSED: {
    message: '这段话 Bow wow 不太好下笔，我们换种说法试试，不着急',
    hint: '您可以改一改说法再试',
    retryable: true,
  },
  ASR_EMPTY: {
    message: '不好意思没听清，请您再靠近手机说一次',
    hint: '不着急，慢慢说就好',
    retryable: true,
  },
  OCR_FAIL: {
    message: '字迹不太好认，请拍清楚一点或光线亮一些',
    hint: '也可以换个角度再拍一张',
    retryable: true,
  },
  FEISHU_AUTH: {
    message: '还没连上飞书，请让家人帮您设置一下',
    hint: '在「我的」里可以设置',
    retryable: false,
  },
  SERVER_ERROR: {
    message: '出了点小问题，请稍后再试',
    hint: '文稿还在，不会丢',
    retryable: true,
  },
  NOT_FOUND: {
    message: '没找到这篇内容',
    hint: '可能已经被收起来了',
    retryable: false,
  },
  REVISION_NOT_FOUND: {
    message: '这份改稿建议找不到了',
    hint: '可能服务刚重启过，请回到写作页让 Bow wow 再改一版',
    retryable: false,
  },
  REVISION_EXPIRED: {
    message: '这份建议已经处理过了',
    hint: '若要再改，请再跟 Bow wow 说一次',
    retryable: false,
  },
  VALIDATION: {
    message: '请再检查一下输入',
    hint: '有不清楚的地方可以问 Bow wow',
    retryable: true,
  },
  API_KEY_MISSING: {
    message: '还没设置对话密钥',
    hint: '请到「我的」里填入 DeepSeek 密钥，或让家人帮您设置',
    retryable: false,
  },
  ZENMUX_KEY_MISSING: {
    message: '还没设置识图/语音的 ZenMux 密钥',
    hint: '请到「我的」里填入 ZenMux 密钥（识图、按住说话识别，走 Gemini 2.5 Flash Lite）',
    retryable: false,
  },
  AUTH_UNAUTHORIZED: {
    message: '请先登录后再继续',
    hint: '登录状态可能已过期，请重新登录',
    retryable: false,
  },
  AUTH_FORBIDDEN: {
    message: '您没有权限执行此操作',
    hint: '如需加入群组，请向群主索取邀请码',
    retryable: false,
  },
  AUTH_CONFLICT: {
    message: '用户名已被占用',
    hint: '请换一个用户名再试',
    retryable: false,
  },
  RATE_LIMITED: {
    message: '操作太频繁了，请稍后再试',
    hint: '若忘记密码，请过一会儿再登录',
    retryable: true,
  },
  AUTH_REGISTRATION_DISABLED: {
    message: '当前未开放注册',
    hint: '请联系家人为您创建账号',
    retryable: false,
  },
  DASHSCOPE_KEY_MISSING: {
    message: '还没设置 Qwen3 朗读的百炼密钥',
    hint: '请到「我的」里填入阿里云百炼 API Key',
    retryable: false,
  },
};

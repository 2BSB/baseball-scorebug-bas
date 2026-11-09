/* 云服务公开配置：值来自 workbuddy_cloud_service(activate) 返回的 publicConfig。
 * 只含可下发到前端的公开字段；环境 ID 与服务端密钥一律不在这里。
 * endpoint 是应用发布域名，与线上页面同源；复用同一个 applicationId 时不会变。 */
window.SCOREBUG_CLOUD_CONFIG = {
  endpoint: 'https://scorebug-live-relay.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_g7Zw2aK5IFYe9Sd2P65p6F_rrDrrqc0LBoM3tqYmDoaau1K66ab2eDM'
};

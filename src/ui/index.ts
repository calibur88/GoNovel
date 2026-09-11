/**
 * ui 层出口：ViewModel → 元素、用户动作 → 事件
 * 只做 DOM 渲染与事件派发，无业务流程；依赖 render 输出与 controller 接口。
 */

export * from "./dom";
export * from "./homepageView";
export * from "./workbenchView";

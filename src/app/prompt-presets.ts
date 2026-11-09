/**
 * Ready-made styles for the three team-editable prompt sections. A preset changes only how the agent talks and reports;
 * the discipline the built-in defaults carry is kept here in one place and re-attached to every preset, so switching
 * style cannot quietly drop a rule.
 */
import type { Localized } from '../sources/kind.ts'
import { promptFile } from './skill-files.ts'
import { TEAM_SECTIONS, type PromptConfig, type TeamSection } from './prompts.ts'

/** What no style layer may trade away, by the section it belongs to. */
const FLOOR: Record<TeamSection, string> = {
  communication: `结果回到原会话交付：谁提的请求，就在谁的那条会话里给出可用的结果或必要的阻塞，不要让人去 GitHub 或工单面板里找结论。
建 PR 不等于已修好，也不等于已合并；PR 只是存在时不算交付里程碑，未就绪的 PR 不通报，加了"还没完成"的说明也不发。
默认沉默：只在结果就绪、需要人做一次动作、或确定无法完成时主动开口；检查还在跑且不需要人动手时，什么都不发。
对每一个新的人工请求回应一次，而不是对每一张新工单回应一次。
GitHub 上发的每条消息（评论、复核回复、PR 描述都算）都以这一行开头：这是自动智能体发的，不是人。`,
  scope: `没有可以安全落地的改动时不伪造 PR，也不造空提交或占位改动。
实施停下来不等于会话结束：说清卡在哪一步、需要谁做什么。
CI 或机器人的反馈不能替你决定"可以继续了"，那要人点头。
调查与实施的轮次不设固定上限；聚焦的活要一路做到复核和 CI。`,
  delivery: `本段没有写明合并用的命令时，PR 由人来合并；不要用智能体账号开启自动合并，要开就只用本段写明的合并命令并锁定 head commit。
不替审阅人批准，也不替人合并；要人合并时在报告里说清等谁。
只改对得上工单的代码；只是相关、或不含本工单改动的 PR，不是关闭的理由。
不削弱检查：放宽阈值、跳过用例、删断言都算削弱，不管是不是为了让它变绿；失败报成失败，草稿标未完成。
以智能体账号和它的 noreply 邮箱提交，每笔提交都要署名（sign-off），不以操作者身份提交；后来补的提交带同样的署名。
没有仓库的本地交付模式下不声称有 PR、也不去创建 PR：提交在工单分支上，报出分支名、改动文件与 diff 摘要，由人来合并。
可复验的证据写进交付的结果文本，由投递落到回信文件；不要自己写那个回信文件，也不要把证据只留在内部报告里。`,
}
export interface PromptPreset { id: string; label: Localized; hint: Localized; sections: Record<TeamSection, string> }
const preset = (id: string, label: Localized, hint: Localized): PromptPreset => ({ id, label, hint,
  sections: Object.fromEntries(TEAM_SECTIONS.map(section => [section, `${promptFile(`presets/${id}/${section}`)}\n\n${FLOOR[section]}`])) as
    Record<TeamSection, string> })
export const PROMPT_PRESETS: readonly PromptPreset[] = [
  preset('brief', { zh: '极简中文', en: 'Brief, in Chinese' }, { zh: '短句，只说结论和要不要动手；过程和内部进展一律不外发。',
    en: 'Short sentences: the outcome and whether anyone must act. Progress stays internal.' }),
  preset('evidence', { zh: '详细带证据', en: 'Detailed, with evidence' }, { zh: '每条结论配命令原文、非空输出与退出码；空输出记"未证"。',
    en: 'Every conclusion carries its command, its non-empty output and its exit code; empty output is recorded as unproven.' }),
  preset('result', { zh: '只报结果', en: 'Results only' }, { zh: '只在就绪、需要人动作或确定做不到时开口，一次一条结果。',
    en: 'Speaks only when something is ready, needs a person, or cannot be done - one result at a time.' }),
]
/** The preset whose three sections match `config` exactly; anything hand-edited stops matching, which is what `custom` means. */
export const presetId = (config: Pick<PromptConfig, TeamSection>): string | undefined =>
  PROMPT_PRESETS.find(item => TEAM_SECTIONS.every(section => config[section] === item.sections[section]))?.id

const assert = require('assert');
const {
  ANALYSIS_TOOL_NAME,
  normalizeEndpoint,
  buildDataset,
  analyzeHomework,
} = require('../homework-ai');

(async () => {
  assert.strictEqual(normalizeEndpoint('api.example.com/v1'), 'https://api.example.com/v1/chat/completions');
  assert.strictEqual(normalizeEndpoint('http://127.0.0.1:11434/v1/chat/completions'), 'http://127.0.0.1:11434/v1/chat/completions');

  const input = {
    className:'八年级一班', teacherName:'刘老师', anonymize:true,
    scope:{ subject:'数学', stage:'closed', dateFrom:'2026-08-01', dateTo:'2026-08-21' },
    students:[{ id:'s1', name:'张三' }, { id:'s2', name:'李四' }],
    assignments:[
      { id:'a1', subject:'数学', title:'练习册 1-2 页', date:'2026-08-10', deadline:'2026-08-11T20:00', submissions:{ s1:'已提交', s2:'未提交' } },
      { id:'a2', subject:'数学', title:'练习册 3-4 页', date:'2026-08-12', deadline:'2026-08-13T20:00', submissions:{ s1:'迟交', s2:'免交' } },
    ],
  };
  const built = buildDataset(input);
  assert.strictEqual(built.dataset.overview.completionRate, 66.7);
  assert.strictEqual(built.dataset.students[0].student, '学生001');
  assert(!JSON.stringify(built.dataset).includes('张三'));

  let sentBody = null;
  const fakeFetch = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return {
      ok:true, status:200,
      text:async () => JSON.stringify({ choices:[{ message:{ tool_calls:[{ function:{ name:ANALYSIS_TOOL_NAME, arguments:JSON.stringify({
        summary:'学生001整体完成稳定，学生002有一次未提交。',
        evidence:[{ metric:'完成率', value:'100%', interpretation:'免交记录未计入分母' }],
        learningIssues:[{ title:'持续关注未提交', evidence:'学生002有一次未提交', severity:'关注', affectedStudents:['学生002'] }],
        studentGroups:[{ group:'保持组', students:['学生001'], basis:'两次均完成', action:'继续保持' }],
        teachingSuggestions:[{ priority:'中', title:'课前提醒', reason:'存在未提交记录', action:'截止前一天提醒' }],
        followUpPlan:[{ timeframe:'下周', action:'复查提交情况', successMetric:'无新增未提交' }],
        limitations:['不包含作业正确率'],
      }) } }] } }] }),
    };
  };
  const result = await analyzeHomework({ endpoint:'https://api.example.com/v1', model:'test-model', apiKey:'secret' }, input, fakeFetch);
  assert.strictEqual(sentBody.tool_choice.function.name, ANALYSIS_TOOL_NAME);
  assert.strictEqual(sentBody.model, 'test-model');
  assert(!JSON.stringify(sentBody).includes('张三'));
  assert(result.report.summary.includes('张三'));
  assert(result.report.learningIssues[0].affectedStudents.includes('李四'));
  assert.strictEqual(result.metadata.anonymized, true);
  console.log('homework AI analysis tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});

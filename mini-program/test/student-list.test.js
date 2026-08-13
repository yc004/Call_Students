const assert = require('assert');
const { parseStudentNames } = require('../src/utils/student-list');

assert.deepStrictEqual(parseStudentNames('张三\n李四\n王五'), ['张三', '李四', '王五']);
assert.deepStrictEqual(parseStudentNames('张三，李四、王五；赵六'), ['张三', '李四', '王五', '赵六']);
assert.deepStrictEqual(parseStudentNames(' 张三 \n\n张三\n 李四 '), ['张三', '李四']);
assert.deepStrictEqual(parseStudentNames(''), []);
console.log('student list tests passed');

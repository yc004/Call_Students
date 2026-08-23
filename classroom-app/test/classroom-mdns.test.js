const assert = require('assert');
const { ClassroomMdnsAdvertiser, serviceNameForCode } = require('../classroom-mdns');

let constructorOptions = null;
let publication = null;
class FakeBonjour {
  constructor(options) { constructorOptions = options; }
  publish(options) {
    publication = options;
    return {
      on() {},
      records() { return [{ type:'A', data:'192.168.43.4' }, { type:'A', data:'10.0.0.2' }, { type:'PTR' }]; },
    };
  }
  unpublishAll(callback) { callback(); }
  destroy() {}
}

const advertiser = new ClassroomMdnsAdvertiser({ BonjourCtor:FakeBonjour });
assert.strictEqual(advertiser.start({
  address:'192.168.43.4', connectionCode:'178-368-049', port:3456, className:'测试班级',
}), true);
assert.deepStrictEqual(constructorOptions, { interface:'192.168.43.4' });
assert.strictEqual(publication.name, 'Banda-178368049');
assert.strictEqual(publication.type, 'banda');
assert.strictEqual(publication.protocol, 'tcp');
assert.strictEqual(publication.port, 3456);
assert.deepStrictEqual(advertiser.service.records(), [{ type:'A', data:'192.168.43.4' }, { type:'PTR' }]);
assert.strictEqual(serviceNameForCode('178-368-049'), 'Banda-178368049');
advertiser.stop();
console.log('classroom mDNS advertisement tests passed');

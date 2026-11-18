"""Run the production OTA restart branch against trial, rollback and timeout timelines."""
import pathlib,re,shutil,subprocess,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class C5UpdateTrialTests(unittest.TestCase):
 def test_trial_must_survive_before_success(self):
  src=(ROOT/'lib/C5LINK/c5link.cpp').read_text();hdr=(ROOT/'lib/C5LINK/c5link.h').read_text()
  start=src.index('case UpdateState::Restarting: {');end=src.index('\n        default:',start)
  branch=src[start:end]
  constants='\n'.join(re.findall(r'static constexpr uint32_t UPDATE_(?:RESTART_TIMEOUT_MS|TRIAL_OBSERVE_MS|STALE_STATUS_MS) = \d+;',hdr))
  harness=r'''
#include <cstdint>
#include <cstring>
#include <cassert>
#define DEBUG(...) ((void)0)
struct Link {
 enum class UpdateState { Restarting, Done, Failed };
 UpdateState updateState_=UpdateState::Restarting;
 const char* version_="1.2.4-rb.1";
 const char* updateVersion_="1.2.4-rb.1";
 uint32_t updateSentMs_=100,updateTrialSeenMs_=0;
 bool scanMode_=true,tuningReady_=true,connected=true;
 int slots=8; const char* error="";
 int enabledCount() const { return slots; }
 bool online(uint32_t) const { return connected; }
 void failUpdate(const char* why) { error=why; updateState_=UpdateState::Failed; }
'''+constants+r'''
 void tick(uint32_t nowMs) { switch(updateState_) {
'''+branch+r'''
 default:break;
 }}
};
int main() {
 using State=Link::UpdateState;
 Link good;good.tick(1000);assert(good.updateState_==State::Restarting);
 good.tick(60999);assert(good.updateState_==State::Restarting);
 good.tick(65999);assert(good.updateState_==State::Restarting);
 good.tick(66000);assert(good.updateState_==State::Done);
 Link rollback;rollback.tick(1000);rollback.tick(60000);
 rollback.version_="1.2.4-rc.1";rollback.tick(62000);
 assert(rollback.updateState_==State::Failed && !strcmp(rollback.error,"rolled back"));
 Link absent;absent.tick(1000);absent.connected=false;absent.tick(90100);
 assert(absent.updateState_==State::Failed && !strcmp(absent.error,"not back"));
 Link late;late.tick(40000);late.tick(90100);
 assert(late.updateState_==State::Failed && !strcmp(late.error,"trial not verified"));
 Link noSlots;noSlots.slots=0;noSlots.tuningReady_=false;
 noSlots.tick(1000);noSlots.tick(66000);assert(noSlots.updateState_==State::Done);
 Link noAck;noAck.tuningReady_=false;noAck.tick(1000);noAck.tick(90100);
 assert(noAck.updateState_==State::Failed);
 Link wrap;wrap.updateSentMs_=0xfffff000u;wrap.tick(0xfffff100u);
 wrap.tick(uint32_t(0xfffff100u+64999));assert(wrap.updateState_==State::Restarting);
 wrap.tick(uint32_t(0xfffff100u+65000));assert(wrap.updateState_==State::Done);
}
'''
  with tempfile.TemporaryDirectory(prefix='fpvgate-ota-') as temp:
   p=pathlib.Path(temp);(p/'test.cpp').write_text(harness)
   subprocess.run([shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe','-std=c++17','-Wall','-Wextra','-Werror',str(p/'test.cpp'),'-o',str(p/'test.exe')],check=True)
   subprocess.run([str(p/'test.exe')],check=True)
if __name__=='__main__':unittest.main()

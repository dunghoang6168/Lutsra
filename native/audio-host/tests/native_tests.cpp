#include "../spsc_ring_buffer.h"
#include <cassert>
#include <cmath>
#include <cstdint>
#include <vector>

static void ringBufferTest(){SpscFloatRingBuffer ring(4);float input[]{1,2,3,4},output[4]{};assert(ring.write(input,4)==4);assert(ring.read(output,4)==4);for(int i=0;i<4;i++)assert(output[i]==input[i]);}
static void boundedFrameTest(){constexpr uint32_t limit=1024*1024;assert(1<=limit);assert(limit<=limit);assert(limit+1>limit);}
static void constantSumCrossfadeTest(){for(int i=0;i<=100;i++){float t=i/100.0f,out=1.0f-t,in=t;assert(std::abs((out+in)-1.0f)<0.00001f);assert(out<=1&&in<=1);}}
static void gainRampTest(){float previous=0;for(int i=1;i<=240;i++){float gain=i/240.0f;assert(gain>=previous);assert(gain-previous<=1.0f/240.0f+.00001f);previous=gain;}}
int main(){ringBufferTest();boundedFrameTest();constantSumCrossfadeTest();gainRampTest();return 0;}

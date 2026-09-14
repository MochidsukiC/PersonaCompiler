#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <dbghelp.h>
#include <intrin.h>
#include <cstdio>
#include <string>
#include <vector>
#include <unordered_map>

static std::wstring quote(const wchar_t* arg) {
  std::wstring out = L"\"";
  unsigned slashes = 0;
  for (auto p = arg; *p; ++p) {
    if (*p == L'\\') { ++slashes; continue; }
    out.append(slashes * (*p == L'"' ? 2 : 1), L'\\'); slashes = 0;
    if (*p == L'"') out += L'\\';
    out += *p;
  }
  out.append(slashes * 2, L'\\'); return out + L'"';
}

static void capture(FILE* log, const wchar_t* directory, DEBUG_EVENT& event, HANDLE process, HANDLE thread) {
  const auto& exception = event.u.Exception.ExceptionRecord;
  fwprintf(log, L"exception pid=%lu tid=%lu code=%08lX first=%lu address=%p parameters=%lu\n", event.dwProcessId, event.dwThreadId, exception.ExceptionCode, event.u.Exception.dwFirstChance, exception.ExceptionAddress, exception.NumberParameters);
  for (DWORD i = 0; i < exception.NumberParameters; ++i) fwprintf(log, L"parameter[%lu]=%llX\n", i, static_cast<unsigned long long>(exception.ExceptionInformation[i]));
  CONTEXT context{}; context.ContextFlags = CONTEXT_FULL;
  if (!GetThreadContext(thread, &context)) { fwprintf(log, L"context-error=%lu\n", GetLastError()); fflush(log); return; }
  EXCEPTION_POINTERS pointers{&event.u.Exception.ExceptionRecord, &context};
  MINIDUMP_EXCEPTION_INFORMATION info{event.dwThreadId, &pointers, FALSE};
  const auto filename = std::wstring(directory) + L"/native-" + std::to_wstring(event.dwProcessId) + L"-" + std::to_wstring(GetTickCount64()) + L".dmp";
  HANDLE file = CreateFileW(filename.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file != INVALID_HANDLE_VALUE) {
    const BOOL ok = MiniDumpWriteDump(process, event.dwProcessId, file, MiniDumpNormal, &info, nullptr, nullptr);
    fwprintf(log, L"dump=%ls success=%d error=%lu\n", filename.c_str(), ok, ok ? 0 : GetLastError()); CloseHandle(file);
  } else fwprintf(log, L"dump-open-error=%lu\n", GetLastError());
  SymSetOptions(SYMOPT_UNDNAME | SYMOPT_DEFERRED_LOADS | SYMOPT_FAIL_CRITICAL_ERRORS | SYMOPT_NO_PROMPTS);
  if (!SymInitialize(process, "", TRUE)) { fwprintf(log, L"symbols-error=%lu\n", GetLastError()); fflush(log); return; }
  STACKFRAME64 frame{};
  frame.AddrPC = {context.Rip, 0, AddrModeFlat}; frame.AddrFrame = {context.Rbp, 0, AddrModeFlat}; frame.AddrStack = {context.Rsp, 0, AddrModeFlat};
  for (int i = 0; i < 48; ++i) {
    if (!StackWalk64(IMAGE_FILE_MACHINE_AMD64, process, thread, &frame, &context, nullptr, SymFunctionTableAccess64, SymGetModuleBase64, nullptr) || !frame.AddrPC.Offset) break;
    IMAGEHLP_MODULE64 module{}; module.SizeOfStruct = sizeof(module);
    SymGetModuleInfo64(process, frame.AddrPC.Offset, &module);
    alignas(SYMBOL_INFO) char buffer[sizeof(SYMBOL_INFO) + MAX_SYM_NAME]{};
    auto symbol = reinterpret_cast<SYMBOL_INFO*>(buffer); symbol->SizeOfStruct = sizeof(SYMBOL_INFO); symbol->MaxNameLen = MAX_SYM_NAME;
    DWORD64 displacement = 0; const BOOL named = SymFromAddr(process, frame.AddrPC.Offset, &displacement, symbol);
    fwprintf(log, L"frame=%d address=%llX module=%hs offset=%llX symbol=%hs displacement=%llX\n", i, frame.AddrPC.Offset, module.ModuleName, frame.AddrPC.Offset - module.BaseOfImage, named ? symbol->Name : "?", displacement);
  }
  SymCleanup(process); fflush(log);
}

__declspec(noinline) static void failFixture() { __fastfail(7); }

int wmain(int argc, wchar_t** argv) {
  if (argc == 2 && std::wstring(argv[1]) == L"--fixture-crash") { failFixture(); return 99; }
  if (argc < 4) return 2;
  FILE* log = nullptr; if (_wfopen_s(&log, argv[1], L"w, ccs=UTF-8") || !log) return 2;
  std::wstring command;
  for (int i = 3; i < argc; ++i) { if (i > 3) command += L' '; command += quote(argv[i]); }
  STARTUPINFOW startup{}; startup.cb = sizeof(startup);
  SECURITY_ATTRIBUTES security{sizeof(security), nullptr, TRUE};
  const auto outputName = std::wstring(argv[1]) + L".stdout.log";
  HANDLE output = CreateFileW(outputName.c_str(), GENERIC_WRITE, FILE_SHARE_READ, &security, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  HANDLE input = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, &security, OPEN_EXISTING, 0, nullptr);
  if (output == INVALID_HANDLE_VALUE || input == INVALID_HANDLE_VALUE) { fwprintf(log, L"stdio-error=%lu\n", GetLastError()); fclose(log); return 2; }
  startup.dwFlags = STARTF_USESTDHANDLES; startup.hStdOutput = output; startup.hStdError = output; startup.hStdInput = input;
  PROCESS_INFORMATION pi{};
  if (!CreateProcessW(argv[3], command.data(), nullptr, nullptr, TRUE, DEBUG_PROCESS | CREATE_NO_WINDOW, nullptr, nullptr, &startup, &pi)) { fwprintf(log, L"launch-error=%lu\n", GetLastError()); fclose(log); return 2; }
  CloseHandle(input); CloseHandle(output);
  const DWORD root = pi.dwProcessId; CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
  std::unordered_map<DWORD, HANDLE> processes, threads;
  const auto started = GetTickCount64(); bool timedOut = false, captured = false; DWORD rootExit = 0;
  for (;;) {
    if (!timedOut && GetTickCount64() - started > 180000) {
      timedOut = true; fwprintf(log, L"diagnostic-timeout\n"); fflush(log);
      for (const auto& entry : processes) TerminateProcess(entry.second, 124);
    }
    DEBUG_EVENT event{};
    if (!WaitForDebugEvent(&event, 1000)) {
      if (GetLastError() == ERROR_SEM_TIMEOUT) continue;
      fwprintf(log, L"wait-error=%lu\n", GetLastError()); fclose(log); return 2;
    }
    DWORD status = DBG_CONTINUE;
    switch (event.dwDebugEventCode) {
      case CREATE_PROCESS_DEBUG_EVENT: {
        processes[event.dwProcessId] = event.u.CreateProcessInfo.hProcess; threads[event.dwThreadId] = event.u.CreateProcessInfo.hThread;
        wchar_t image[32768]; DWORD size = 32768;
        if (QueryFullProcessImageNameW(event.u.CreateProcessInfo.hProcess, 0, image, &size)) fwprintf(log, L"process pid=%lu image=%ls\n", event.dwProcessId, image);
        if (event.u.CreateProcessInfo.hFile) CloseHandle(event.u.CreateProcessInfo.hFile); break;
      }
      case CREATE_THREAD_DEBUG_EVENT: threads[event.dwThreadId] = event.u.CreateThread.hThread; break;
      case EXIT_THREAD_DEBUG_EVENT: threads.erase(event.dwThreadId); break;
      case LOAD_DLL_DEBUG_EVENT: if (event.u.LoadDll.hFile) CloseHandle(event.u.LoadDll.hFile); break;
      case EXCEPTION_DEBUG_EVENT: {
        const auto code = event.u.Exception.ExceptionRecord.ExceptionCode;
        if (code != EXCEPTION_BREAKPOINT && code != 0x4000001F) {
          status = DBG_EXCEPTION_NOT_HANDLED;
          if (!event.u.Exception.dwFirstChance || code == 0xC0000409) { capture(log, argv[2], event, processes.at(event.dwProcessId), threads.at(event.dwThreadId)); captured = true; }
        }
        break;
      }
      case EXIT_PROCESS_DEBUG_EVENT:
        fwprintf(log, L"exit pid=%lu code=%08lX\n", event.dwProcessId, event.u.ExitProcess.dwExitCode);
        if (event.dwProcessId == root) rootExit = event.u.ExitProcess.dwExitCode;
        processes.erase(event.dwProcessId); break;
    }
    fflush(log);
    if (!ContinueDebugEvent(event.dwProcessId, event.dwThreadId, status)) { fwprintf(log, L"continue-error=%lu\n", GetLastError()); fclose(log); return 2; }
    if (processes.empty()) break;
  }
  fwprintf(log, L"complete root-exit=%08lX captured=%d timeout=%d\n", rootExit, captured, timedOut); fclose(log);
  return timedOut ? 124 : captured ? 1 : rootExit ? 1 : 0;
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;

namespace AudioCap
{
    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr audioSessionGuid);
        [PreserveSig] int GetBufferSize(out uint frameCount);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint paddingFrameCount);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr eventHandle);
        [PreserveSig] int GetService(ref Guid interfaceId, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frameCount, out uint bufferFlags, out ulong devicePosition, out ulong performanceCounterPosition);
        [PreserveSig] int ReleaseBuffer(uint frameCount);
        [PreserveSig] int GetNextPacketSize(out uint frameCount);
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceAsyncOperation
    {
        [PreserveSig] int GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceCompletionHandler
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation);
    }

    [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAgileObject { }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorComObject { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint deviceCount);
        [PreserveSig] int Item(uint deviceIndex, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid interfaceId, int classContext, IntPtr activationParameters, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int streamFlags, out IntPtr sessionControl);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int streamFlags, out IntPtr audioVolume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnumerator);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int sessionCount);
        [PreserveSig] int GetSession(int sessionIndex, out IAudioSessionControl2 session);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName(out IntPtr displayName);
        [PreserveSig] int SetDisplayName(IntPtr displayName, IntPtr eventContext);
        [PreserveSig] int GetIconPath(out IntPtr iconPath);
        [PreserveSig] int SetIconPath(IntPtr iconPath, IntPtr eventContext);
        [PreserveSig] int GetGroupingParam(out Guid groupingId);
        [PreserveSig] int SetGroupingParam(IntPtr groupingId, IntPtr eventContext);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int GetSessionIdentifier(out IntPtr sessionIdentifier);
        [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr sessionInstanceIdentifier);
        [PreserveSig] int GetProcessId(out uint processId);
    }

    sealed class ActivationCompletedSignal : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public readonly ManualResetEvent Completed = new ManualResetEvent(false);

        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation)
        {
            Completed.Set();
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ProcessEntry32
    {
        public uint Size;
        public uint UsageCount;
        public uint ProcessId;
        public IntPtr DefaultHeapId;
        public uint ModuleId;
        public uint ThreadCount;
        public uint ParentProcessId;
        public int BasePriority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string ExecutableName;
    }

    static class WindowsApi
    {
        public const uint SnapshotProcesses = 0x2;

        [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = true)]
        public static extern int ActivateAudioInterfaceAsync(
            [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
            [MarshalAs(UnmanagedType.LPStruct)] Guid interfaceId,
            IntPtr activationParameters,
            IActivateAudioInterfaceCompletionHandler completionHandler,
            out IActivateAudioInterfaceAsyncOperation activationOperation);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr windowHandle, out uint processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "Process32FirstW")]
        public static extern bool Process32First(IntPtr snapshot, ref ProcessEntry32 entry);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "Process32NextW")]
        public static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry32 entry);

        [DllImport("kernel32.dll")]
        public static extern bool CloseHandle(IntPtr handle);
    }

    static class AudioFormat
    {
        public const int SampleRate = 48000;
        public const int ChannelCount = 2;
        public const int BitsPerSample = 16;
        public const int BytesPerFrame = ChannelCount * BitsPerSample / 8;
    }

    static class Status
    {
        public static void Write(string message)
        {
            Console.Error.WriteLine(message);
            Console.Error.Flush();
        }

        public static void ThrowIfFailed(int result, string operationName)
        {
            if (result < 0) throw new Exception(operationName + " falhou (0x" + result.ToString("X8") + ")");
        }
    }

    enum LoopbackMode
    {
        IncludeTargetProcessTree = 0,
        ExcludeTargetProcessTree = 1,
    }

    sealed class SampleBuffer
    {
        readonly short[] samples;
        readonly object gate = new object();
        int readIndex;
        int writeIndex;
        int storedCount;

        public SampleBuffer(int capacityInSamples)
        {
            samples = new short[capacityInSamples];
        }

        public void AppendPcmBytes(byte[] bytes, int byteCount)
        {
            lock (gate)
            {
                for (int offset = 0; offset + 1 < byteCount; offset += 2)
                {
                    samples[writeIndex] = (short)(bytes[offset] | (bytes[offset + 1] << 8));
                    writeIndex = (writeIndex + 1) % samples.Length;
                    if (storedCount == samples.Length) readIndex = (readIndex + 1) % samples.Length;
                    else storedCount++;
                }
            }
        }

        public void DiscardAllBut(int maximumSamples)
        {
            lock (gate)
            {
                if (storedCount <= maximumSamples) return;
                int excess = storedCount - maximumSamples;
                excess -= excess % AudioFormat.ChannelCount;
                readIndex = (readIndex + excess) % samples.Length;
                storedCount -= excess;
            }
        }

        public void MixInto(int[] mix)
        {
            lock (gate)
            {
                int available = Math.Min(storedCount, mix.Length);
                available -= available % AudioFormat.ChannelCount;
                for (int index = 0; index < available; index++)
                {
                    mix[index] += samples[readIndex];
                    readIndex = (readIndex + 1) % samples.Length;
                }
                storedCount -= available;
            }
        }
    }

    static class ProcessLoopbackActivation
    {
        const string ProcessLoopbackDevicePath = "VAD\\Process_Loopback";
        const int ProcessLoopbackActivationType = 1;
        const ushort PropVariantBlobType = 65;
        const int ActivationParametersSize = 12;
        const int PropVariantSize = 24;
        const int ActivationTimeoutMs = 5000;
        const int WaveFormatSize = 18;
        const ushort WaveFormatPcm = 1;
        const int SharedMode = 0;
        const long BufferDurationIn100Nanoseconds = 200000;
        const uint StreamFlagLoopback = 0x00020000;
        const uint StreamFlagEventCallback = 0x00040000;
        const uint StreamFlagDefaultQualityResampling = 0x08000000;
        const uint StreamFlagAutoConvertPcm = 0x80000000;

        public static IAudioClient ActivateAndInitialize(uint targetProcessId, LoopbackMode mode)
        {
            IAudioClient audioClient = Activate(targetProcessId, mode);
            InitializeCaptureFormat(audioClient);
            return audioClient;
        }

        static IAudioClient Activate(uint targetProcessId, LoopbackMode mode)
        {
            IntPtr activationParameters = Marshal.AllocHGlobal(ActivationParametersSize);
            IntPtr propVariant = Marshal.AllocHGlobal(PropVariantSize);
            try
            {
                Marshal.WriteInt32(activationParameters, 0, ProcessLoopbackActivationType);
                Marshal.WriteInt32(activationParameters, 4, unchecked((int)targetProcessId));
                Marshal.WriteInt32(activationParameters, 8, (int)mode);

                for (int offset = 0; offset < PropVariantSize; offset++) Marshal.WriteByte(propVariant, offset, 0);
                Marshal.WriteInt16(propVariant, 0, unchecked((short)PropVariantBlobType));
                Marshal.WriteInt32(propVariant, 8, ActivationParametersSize);
                Marshal.WriteIntPtr(propVariant, IntPtr.Size == 8 ? 16 : 12, activationParameters);

                var completedSignal = new ActivationCompletedSignal();
                Status.ThrowIfFailed(WindowsApi.ActivateAudioInterfaceAsync(ProcessLoopbackDevicePath, typeof(IAudioClient).GUID, propVariant, completedSignal, out var operation), "ActivateAudioInterfaceAsync");
                if (!completedSignal.Completed.WaitOne(ActivationTimeoutMs)) throw new Exception("tempo esgotado ativando o audio");

                Status.ThrowIfFailed(operation.GetActivateResult(out int activationResult, out object activatedInterface), "GetActivateResult");
                Status.ThrowIfFailed(activationResult, "ativacao (precisa de Windows 10 versao 2004 ou mais novo)");
                return (IAudioClient)activatedInterface;
            }
            finally
            {
                Marshal.FreeHGlobal(propVariant);
                Marshal.FreeHGlobal(activationParameters);
            }
        }

        static void InitializeCaptureFormat(IAudioClient audioClient)
        {
            IntPtr waveFormat = Marshal.AllocHGlobal(WaveFormatSize);
            try
            {
                Marshal.WriteInt16(waveFormat, 0, unchecked((short)WaveFormatPcm));
                Marshal.WriteInt16(waveFormat, 2, AudioFormat.ChannelCount);
                Marshal.WriteInt32(waveFormat, 4, AudioFormat.SampleRate);
                Marshal.WriteInt32(waveFormat, 8, AudioFormat.SampleRate * AudioFormat.BytesPerFrame);
                Marshal.WriteInt16(waveFormat, 12, AudioFormat.BytesPerFrame);
                Marshal.WriteInt16(waveFormat, 14, AudioFormat.BitsPerSample);
                Marshal.WriteInt16(waveFormat, 16, 0);

                uint streamFlags = StreamFlagLoopback | StreamFlagEventCallback | StreamFlagAutoConvertPcm | StreamFlagDefaultQualityResampling;
                Status.ThrowIfFailed(audioClient.Initialize(SharedMode, streamFlags, BufferDurationIn100Nanoseconds, 0, waveFormat, IntPtr.Zero), "Initialize");
            }
            finally
            {
                Marshal.FreeHGlobal(waveFormat);
            }
        }
    }

    sealed class ProcessLoopbackCapture : IDisposable
    {
        const uint BufferFlagSilent = 0x2;
        const int PacketWaitTimeoutMs = 100;
        const int StopTimeoutMs = 1000;

        public uint ProcessId { get; }
        public SampleBuffer Buffer { get; } = new SampleBuffer(AudioFormat.SampleRate * AudioFormat.ChannelCount);

        readonly IAudioClient audioClient;
        readonly IAudioCaptureClient captureClient;
        readonly AutoResetEvent packetReady = new AutoResetEvent(false);
        readonly Thread captureThread;
        volatile bool keepCapturing = true;

        ProcessLoopbackCapture(uint processId, IAudioClient audioClient)
        {
            ProcessId = processId;
            this.audioClient = audioClient;
            Guid captureClientId = typeof(IAudioCaptureClient).GUID;
            Status.ThrowIfFailed(audioClient.GetService(ref captureClientId, out object captureService), "GetService");
            captureClient = (IAudioCaptureClient)captureService;
            Status.ThrowIfFailed(audioClient.SetEventHandle(packetReady.SafeWaitHandle.DangerousGetHandle()), "SetEventHandle");
            Status.ThrowIfFailed(audioClient.Start(), "Start");
            captureThread = new Thread(CopyPacketsIntoBuffer) { IsBackground = true };
            captureThread.Start();
        }

        public static ProcessLoopbackCapture Start(uint processId, LoopbackMode mode)
        {
            return new ProcessLoopbackCapture(processId, ProcessLoopbackActivation.ActivateAndInitialize(processId, mode));
        }

        void CopyPacketsIntoBuffer()
        {
            var bytes = new byte[AudioFormat.SampleRate * AudioFormat.BytesPerFrame];
            while (keepCapturing)
            {
                packetReady.WaitOne(PacketWaitTimeoutMs);
                while (keepCapturing)
                {
                    if (captureClient.GetNextPacketSize(out uint packetFrameCount) < 0 || packetFrameCount == 0) break;
                    if (captureClient.GetBuffer(out IntPtr data, out uint frameCount, out uint bufferFlags, out _, out _) < 0) break;
                    int byteCount = (int)frameCount * AudioFormat.BytesPerFrame;
                    if (bytes.Length < byteCount) bytes = new byte[byteCount];
                    bool isSilent = (bufferFlags & BufferFlagSilent) != 0 || data == IntPtr.Zero;
                    if (isSilent) Array.Clear(bytes, 0, byteCount);
                    else Marshal.Copy(data, bytes, 0, byteCount);
                    captureClient.ReleaseBuffer(frameCount);
                    Buffer.AppendPcmBytes(bytes, byteCount);
                }
            }
        }

        public void Dispose()
        {
            keepCapturing = false;
            packetReady.Set();
            captureThread.Join(StopTimeoutMs);
            audioClient.Stop();
        }
    }

    sealed class ProcessSnapshot
    {
        const int MaximumAncestorDepth = 64;

        readonly Dictionary<uint, ProcessEntry32> entriesById;

        ProcessSnapshot(Dictionary<uint, ProcessEntry32> entriesById)
        {
            this.entriesById = entriesById;
        }

        public static ProcessSnapshot Take()
        {
            var entriesById = new Dictionary<uint, ProcessEntry32>();
            IntPtr snapshot = WindowsApi.CreateToolhelp32Snapshot(WindowsApi.SnapshotProcesses, 0);
            try
            {
                var entry = new ProcessEntry32 { Size = (uint)Marshal.SizeOf(typeof(ProcessEntry32)) };
                bool hasEntry = WindowsApi.Process32First(snapshot, ref entry);
                while (hasEntry)
                {
                    entriesById[entry.ProcessId] = entry;
                    hasEntry = WindowsApi.Process32Next(snapshot, ref entry);
                }
            }
            finally
            {
                WindowsApi.CloseHandle(snapshot);
            }
            return new ProcessSnapshot(entriesById);
        }

        public bool Contains(uint processId)
        {
            return entriesById.ContainsKey(processId);
        }

        public string NameOf(uint processId)
        {
            return entriesById.TryGetValue(processId, out var entry) ? entry.ExecutableName : "?";
        }

        public IEnumerable<uint> SelfAndAncestors(uint processId)
        {
            uint currentId = processId;
            for (int depth = 0; depth < MaximumAncestorDepth && currentId != 0; depth++)
            {
                yield return currentId;
                if (!entriesById.TryGetValue(currentId, out var entry) || entry.ParentProcessId == currentId) yield break;
                currentId = entry.ParentProcessId;
            }
        }

        public bool BelongsToExcludedProcess(uint processId, ISet<uint> excludedProcessIds, ISet<string> excludedProcessNames)
        {
            return SelfAndAncestors(processId).Any((ancestorId) => excludedProcessIds.Contains(ancestorId) || excludedProcessNames.Contains(NameOf(ancestorId)));
        }

        public bool IsDescendantOfAny(uint processId, IEnumerable<uint> possibleAncestorIds)
        {
            var ancestors = new HashSet<uint>(SelfAndAncestors(processId).Skip(1));
            return possibleAncestorIds.Any(ancestors.Contains);
        }
    }

    static class AudioSessionScanner
    {
        const int RenderDataFlow = 0;
        const int ActiveDeviceState = 1;
        const int AllClassContexts = 23;

        public static HashSet<uint> ListProcessesWithAudioSessions()
        {
            return new HashSet<uint>(ListSessions().Select((session) => session.ProcessId).Where((processId) => processId != 0));
        }

        public static List<AudioSessionInfo> ListSessions()
        {
            var sessionInfos = new List<AudioSessionInfo>();
            var deviceEnumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            if (deviceEnumerator.EnumAudioEndpoints(RenderDataFlow, ActiveDeviceState, out var devices) < 0) return sessionInfos;
            devices.GetCount(out uint deviceCount);
            for (uint deviceIndex = 0; deviceIndex < deviceCount; deviceIndex++)
            {
                if (devices.Item(deviceIndex, out var device) < 0) continue;
                Guid sessionManagerId = typeof(IAudioSessionManager2).GUID;
                if (device.Activate(ref sessionManagerId, AllClassContexts, IntPtr.Zero, out object sessionManagerObject) < 0) continue;
                var sessionManager = (IAudioSessionManager2)sessionManagerObject;
                if (sessionManager.GetSessionEnumerator(out var sessions) < 0) continue;
                sessions.GetCount(out int sessionCount);
                for (int sessionIndex = 0; sessionIndex < sessionCount; sessionIndex++)
                {
                    if (sessions.GetSession(sessionIndex, out var session) < 0) continue;
                    session.GetState(out int state);
                    int processIdResult = session.GetProcessId(out uint processId);
                    sessionInfos.Add(new AudioSessionInfo { DeviceIndex = deviceIndex, ProcessId = processIdResult >= 0 ? processId : 0, State = state });
                    Marshal.ReleaseComObject(session);
                }
                Marshal.ReleaseComObject(sessions);
                Marshal.ReleaseComObject(sessionManager);
                Marshal.ReleaseComObject(device);
            }
            Marshal.ReleaseComObject(devices);
            Marshal.ReleaseComObject(deviceEnumerator);
            return sessionInfos;
        }
    }

    sealed class AudioSessionInfo
    {
        public uint DeviceIndex;
        public uint ProcessId;
        public int State;
    }

    static class AudioMixer
    {
        const int ChunkFrames = 480;
        const int StartupDelayMs = 40;
        const int MaximumBufferedMs = 150;
        const int PollIntervalMs = 5;

        public static void Run(Func<IEnumerable<SampleBuffer>> listSourceBuffers, Action periodicWork, TimeSpan periodicInterval, double stopAfterSeconds, Stream output, Func<bool> shouldKeepRunning)
        {
            Thread.Sleep(StartupDelayMs);
            int maximumBufferedSamples = AudioFormat.SampleRate * AudioFormat.ChannelCount * MaximumBufferedMs / 1000;
            var mix = new int[ChunkFrames * AudioFormat.ChannelCount];
            var pcmBytes = new byte[ChunkFrames * AudioFormat.BytesPerFrame];
            var clock = Stopwatch.StartNew();
            TimeSpan lastPeriodicWork = TimeSpan.Zero;
            long framesWritten = 0;

            while (shouldKeepRunning())
            {
                if (stopAfterSeconds > 0 && clock.Elapsed.TotalSeconds >= stopAfterSeconds) return;
                if (periodicWork != null && clock.Elapsed - lastPeriodicWork >= periodicInterval)
                {
                    periodicWork();
                    lastPeriodicWork = clock.Elapsed;
                }

                long framesDue = (long)(clock.Elapsed.TotalSeconds * AudioFormat.SampleRate) - framesWritten;
                while (framesDue >= ChunkFrames)
                {
                    Array.Clear(mix, 0, mix.Length);
                    foreach (SampleBuffer buffer in listSourceBuffers())
                    {
                        buffer.DiscardAllBut(maximumBufferedSamples);
                        buffer.MixInto(mix);
                    }
                    for (int index = 0; index < mix.Length; index++)
                    {
                        short sample = (short)Math.Max(short.MinValue, Math.Min(short.MaxValue, mix[index]));
                        pcmBytes[index * 2] = (byte)(sample & 0xFF);
                        pcmBytes[index * 2 + 1] = (byte)((sample >> 8) & 0xFF);
                    }
                    try
                    {
                        output.Write(pcmBytes, 0, pcmBytes.Length);
                    }
                    catch (IOException)
                    {
                        return;
                    }
                    framesWritten += ChunkFrames;
                    framesDue -= ChunkFrames;
                }
                output.Flush();
                Thread.Sleep(PollIntervalMs);
            }
        }
    }

    sealed class CaptureRequest
    {
        public string Mode;
        public uint TargetProcessId;
        public LoopbackMode LoopbackMode;
        public double StopAfterSeconds;
        public readonly HashSet<uint> ExcludedProcessIds = new HashSet<uint>();
        public readonly HashSet<string> ExcludedProcessNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    }

    static class Program
    {
        static readonly TimeSpan SessionScanInterval = TimeSpan.FromMilliseconds(1500);
        static readonly string[] AudioRoutingProcessNames =
        {
            "audiodg.exe",
            "audiocap.exe",
            "SteelSeriesSonar.exe",
            "voicemeeter.exe",
            "voicemeeter_x64.exe",
            "voicemeeterpro.exe",
            "voicemeeterpro_x64.exe",
            "voicemeeter8.exe",
            "voicemeeter8x64.exe",
            "WaveLink.exe",
        };
        static volatile bool parentIsAlive = true;

        [MTAThread]
        static int Main(string[] arguments)
        {
            try
            {
                CaptureRequest request = ParseArguments(arguments);
                if (request == null) return 2;
                if (request.StopAfterSeconds <= 0) StopWhenParentCloses();
                Stream output = Console.OpenStandardOutput();
                if (request.Mode == "sessions") ListAudioSessions();
                else if (request.Mode == "everything-except") RunEverythingExceptCapture(request, output);
                else RunSingleProcessCapture(request, output);
                Status.Write("INFO fim");
                return 0;
            }
            catch (Exception error)
            {
                Status.Write("ERR " + error.Message.Replace('\n', ' '));
                return 1;
            }
        }

        static CaptureRequest ParseArguments(string[] arguments)
        {
            if (arguments.Length < 1)
            {
                Status.Write("ERR uso: audiocap include|exclude <pid> | window <hwnd> | everything-except [--exclude-pid N] [--exclude-name app.exe] [--seconds N]");
                return null;
            }

            var request = new CaptureRequest { Mode = arguments[0].ToLowerInvariant() };
            for (int index = 1; index < arguments.Length - 1; index++)
            {
                string value = arguments[index + 1];
                if (arguments[index] == "--seconds") double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out request.StopAfterSeconds);
                if (arguments[index] == "--exclude-pid") request.ExcludedProcessIds.Add(uint.Parse(value, CultureInfo.InvariantCulture));
                if (arguments[index] == "--exclude-name") request.ExcludedProcessNames.Add(value);
            }

            if (request.Mode == "everything-except")
            {
                foreach (string processName in AudioRoutingProcessNames) request.ExcludedProcessNames.Add(processName);
                return request;
            }
            if (request.Mode == "sessions") return request;

            if (arguments.Length < 2)
            {
                Status.Write("ERR falta o alvo da captura");
                return null;
            }
            if (request.Mode == "window")
            {
                long windowHandle = long.Parse(arguments[1], CultureInfo.InvariantCulture);
                WindowsApi.GetWindowThreadProcessId(new IntPtr(windowHandle), out request.TargetProcessId);
                if (request.TargetProcessId == 0)
                {
                    Status.Write("ERR janela nao encontrada (hwnd " + windowHandle + ")");
                    return null;
                }
                request.LoopbackMode = LoopbackMode.IncludeTargetProcessTree;
                Status.Write("INFO janela " + windowHandle + " -> pid " + request.TargetProcessId);
                return request;
            }
            if (request.Mode == "include" || request.Mode == "exclude")
            {
                request.TargetProcessId = uint.Parse(arguments[1], CultureInfo.InvariantCulture);
                request.LoopbackMode = request.Mode == "include" ? LoopbackMode.IncludeTargetProcessTree : LoopbackMode.ExcludeTargetProcessTree;
                return request;
            }

            Status.Write("ERR modo invalido: " + request.Mode);
            return null;
        }

        static void StopWhenParentCloses()
        {
            var watcher = new Thread(() =>
            {
                try
                {
                    Stream standardInput = Console.OpenStandardInput();
                    var ignoredBytes = new byte[64];
                    while (standardInput.Read(ignoredBytes, 0, ignoredBytes.Length) > 0) { }
                }
                catch (IOException) { }
                parentIsAlive = false;
            });
            watcher.IsBackground = true;
            watcher.Start();
        }

        static void RunSingleProcessCapture(CaptureRequest request, Stream output)
        {
            using (var capture = ProcessLoopbackCapture.Start(request.TargetProcessId, request.LoopbackMode))
            {
                string modeName = request.LoopbackMode == LoopbackMode.IncludeTargetProcessTree ? "include" : "exclude";
                Status.Write("READY pid=" + request.TargetProcessId + " mode=" + modeName + " rate=" + AudioFormat.SampleRate + " ch=" + AudioFormat.ChannelCount);
                AudioMixer.Run(() => new[] { capture.Buffer }, null, TimeSpan.Zero, request.StopAfterSeconds, output, () => parentIsAlive);
            }
        }

        static void RunEverythingExceptCapture(CaptureRequest request, Stream output)
        {
            var capturesByProcessId = new Dictionary<uint, ProcessLoopbackCapture>();
            var processesThatCannotBeCaptured = new HashSet<uint>();

            Action refreshCaptures = () =>
            {
                try
                {
                    ProcessSnapshot snapshot = ProcessSnapshot.Take();
                    StopCapturesOfFinishedProcesses(capturesByProcessId, snapshot);
                    List<uint> allowedProcessIds = AudioSessionScanner.ListProcessesWithAudioSessions()
                        .Where((processId) => !snapshot.BelongsToExcludedProcess(processId, request.ExcludedProcessIds, request.ExcludedProcessNames))
                        .ToList();
                    foreach (uint processId in allowedProcessIds)
                    {
                        if (capturesByProcessId.ContainsKey(processId) || processesThatCannotBeCaptured.Contains(processId)) continue;
                        if (snapshot.IsDescendantOfAny(processId, allowedProcessIds)) continue;
                        try
                        {
                            capturesByProcessId[processId] = ProcessLoopbackCapture.Start(processId, LoopbackMode.IncludeTargetProcessTree);
                            Status.Write("INFO capturando pid " + processId + " (" + snapshot.NameOf(processId) + ")");
                        }
                        catch (Exception error)
                        {
                            processesThatCannotBeCaptured.Add(processId);
                            Status.Write("INFO nao deu pra capturar pid " + processId + ": " + error.Message);
                        }
                    }
                }
                catch (Exception error)
                {
                    Status.Write("INFO falha ao procurar programas com som: " + error.Message);
                }
            };

            refreshCaptures();
            Status.Write("READY mode=everything-except sources=" + capturesByProcessId.Count + " rate=" + AudioFormat.SampleRate + " ch=" + AudioFormat.ChannelCount);
            try
            {
                AudioMixer.Run(() => capturesByProcessId.Values.Select((capture) => capture.Buffer).ToList(), refreshCaptures, SessionScanInterval, request.StopAfterSeconds, output, () => parentIsAlive);
            }
            finally
            {
                foreach (ProcessLoopbackCapture capture in capturesByProcessId.Values) capture.Dispose();
            }
        }

        static void ListAudioSessions()
        {
            ProcessSnapshot snapshot = ProcessSnapshot.Take();
            string[] stateNames = { "inativa", "ativa", "expirada" };
            foreach (AudioSessionInfo session in AudioSessionScanner.ListSessions())
            {
                string stateName = session.State >= 0 && session.State < stateNames.Length ? stateNames[session.State] : session.State.ToString();
                Status.Write("SESSION dispositivo=" + session.DeviceIndex + " pid=" + session.ProcessId + " (" + snapshot.NameOf(session.ProcessId) + ") " + stateName);
            }
        }

        static void StopCapturesOfFinishedProcesses(Dictionary<uint, ProcessLoopbackCapture> capturesByProcessId, ProcessSnapshot snapshot)
        {
            foreach (uint processId in capturesByProcessId.Keys.Where((processId) => !snapshot.Contains(processId)).ToList())
            {
                capturesByProcessId[processId].Dispose();
                capturesByProcessId.Remove(processId);
            }
        }
    }
}
